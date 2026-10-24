import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { audit, auditEvent, onAudit, queryAudit } from "./audit.ts";
import { authStatus, login, logout, requireAuth, tailscaleUser } from "./auth.ts";
import { chromeStatus, startChrome } from "./chrome.ts";
import { config, HOME, INBOX_DIR, MEDIA_DIR, MEMORY_FILE, PROFILE_FILE, ROOT } from "./config.ts";
import { handleMcp, inboxNote } from "./mcp.ts";
import { copilotEnabled, oc, OpencodeError, opencodeHealthy, setSessionContext, startOpencode, subscribeEvents, type OpencodeEvent } from "./opencode.ts";
import { markVisible, push, subscribe as pushSubscribe, subscriptionCount, unsubscribe as pushUnsubscribe, vapidPublicKey } from "./push.ts";
import { keepAwakeOn, QUICK_ACTIONS } from "./quick.ts";
import { countDownload, getShare, pruneShares } from "./shares.ts";

// ---------- event hub: opencode SSE → every connected browser ----------

type Listener = (e: { type: string; data: unknown }) => void;
const listeners = new Set<Listener>();
const broadcast = (type: string, data: unknown) => listeners.forEach((l) => l({ type, data }));

/** Sessions where the user flipped "auto-approve": permission asks are answered "once" automatically. */
const autoApprove = new Set<string>();
/** Session titles, for notifications ("Done: Find my resume"). */
const sessionTitles = new Map<string, string>();
let eventsConnected = false;

onAudit((entry) => broadcast("lazylink.audit", entry));

function describePermission(action: string, resources: string[]) {
  const what = resources.filter((r) => r !== "*").join(", ");
  const verb =
    action === "shell" ? "Run" : action === "edit" ? "Edit" : action === "external_directory" ? "Access" : action.replace(/_/g, " ");
  return what ? `${verb}: ${what}`.slice(0, 180) : verb;
}

function onOpencodeEvent(e: OpencodeEvent) {
  auditEvent(e);
  const sid: string | undefined = e.data?.sessionID;
  if (e.type === "permission.asked" && sid) {
    if (autoApprove.has(sid)) {
      audit("permission.auto-approved", sid, { action: e.data.action, resources: e.data.resources }, "lazylink");
      void oc(`/api/session/${sid}/permission/${e.data.id}/reply`, { method: "POST", body: { decision: "once" } }).catch((err) =>
        console.error("[auto-approve]", err.message),
      );
    } else {
      void push({ title: "Approval needed", body: describePermission(e.data.action, e.data.resources ?? []), tag: `perm-${sid}`, url: `/?session=${sid}` });
    }
  }
  if (e.type === "session.renamed" && sid && e.data.title) sessionTitles.set(sid, e.data.title);
  if ((e.type === "session.execution.succeeded" || e.type === "session.execution.failed") && sid) {
    const ok = e.type.endsWith("succeeded");
    void push({
      title: ok ? "Done" : "Task failed",
      body: sessionTitles.get(sid) ?? (ok ? "Your Mac finished the task." : "Open lazylink to see what happened."),
      tag: `run-${sid}`,
      url: `/?session=${sid}`,
    });
  }
  if (e.type.startsWith("session.") || e.type.startsWith("permission.")) broadcast(e.type, e.data);
}

/** Dynamic context for the agent: the time, which device the user is on, and the latest memory. */
function sessionContext(c: Context) {
  const ua = c.req.header("user-agent") ?? "";
  const device = /Android/i.test(ua) ? "an Android phone" : /iPhone|iPad/i.test(ua) ? "an iPhone/iPad" : /Mobile/i.test(ua) ? "a phone" : "a computer browser";
  const now = new Date();
  return [
    "## Live lazylink context",
    `- Now: ${now.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    `- The user is messaging from ${device}, remotely through lazylink${tailscaleUser(c) ? ` as ${tailscaleUser(c)}` : ""}.`,
    `- Mac user home: ${HOME}. Files the user sends arrive in ${INBOX_DIR}.`,
    "",
    readFileSync(MEMORY_FILE, "utf8"),
  ].join("\n");
}

// ---------- helpers ----------

type ModelRef = { providerID: string; id: string };

function parseModel(s: string | undefined): ModelRef | undefined {
  const m = s?.match(/^([^/]+)\/(.+)$/);
  return m ? { providerID: m[1], id: m[2] } : undefined;
}

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "llamacpp", "llama.cpp"]);

async function listModels() {
  const { data } = await oc<{ data: any[] }>("/api/model");
  return data
    .filter((m) => m.capabilities?.tools !== false && (m.providerID !== "copilot" || copilotEnabled))
    .map((m) => {
      const costs: any[] = Array.isArray(m.cost) ? m.cost : [];
      const local = LOCAL_PROVIDERS.has(m.providerID);
      const free = local || (costs.length > 0 && costs.every((c) => !c.input && !c.output));
      return { providerID: m.providerID, id: m.id, name: m.name ?? m.id, free, local };
    })
    .sort((a, b) => Number(b.local) - Number(a.local) || Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
}

async function defaultModel(): Promise<ModelRef | undefined> {
  const configured = parseModel(config.defaultModel);
  if (configured) return configured;
  const models = await listModels();
  const firstFree = models.find((m) => m.free);
  return firstFree ? { providerID: firstFree.providerID, id: firstFree.id } : undefined;
}

// ---------- app ----------

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof OpencodeError) return c.json({ error: err.body || err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

app.get("/auth/status", authStatus);
app.post("/auth/login", login);
app.post("/auth/logout", logout);

const api = new Hono();
api.use(requireAuth);

api.get("/status", async (c) =>
  c.json({
    opencode: await opencodeHealthy(),
    events: eventsConnected,
    chrome: await chromeStatus(),
    workdir: config.workdir,
    defaultModel: await defaultModel().catch(() => undefined),
    user: tailscaleUser(c) ?? null,
    keepAwake: keepAwakeOn(),
    pushSubscriptions: subscriptionCount(),
  }),
);

api.get("/models", async (c) => c.json(await listModels()));

api.get("/sessions", async (c) => {
  const res = await oc<{ data: any[] }>("/api/session", {
    query: { limit: "50", order: "desc", parentID: "null", directory: config.workdir },
  });
  return c.json(
    res.data.map((s) => ({
      id: s.id,
      title: s.title ?? s.slug ?? null,
      model: s.model ?? null,
      outcome: s.outcome ?? null,
      cost: s.cost ?? 0,
      created: s.time?.created,
      updated: s.time?.updated,
      autoApprove: autoApprove.has(s.id),
    })).map((s) => (s.title && sessionTitles.set(s.id, s.title), s)),
  );
});

api.post("/sessions", async (c) => {
  const body = await c.req.json<{ model?: ModelRef }>().catch(() => ({}) as { model?: ModelRef });
  const model = body.model ?? (await defaultModel());
  const res = await oc<{ data: any }>("/api/session", {
    method: "POST",
    body: { location: { directory: config.workdir }, ...(model && { model }) },
  });
  audit("session.created", res.data.id, { model }, tailscaleUser(c) ?? "local");
  await setSessionContext(res.data.id, sessionContext(c));
  return c.json(res.data);
});

api.delete("/sessions/:id", async (c) => {
  await oc(`/api/session/${c.req.param("id")}`, { method: "DELETE" });
  autoApprove.delete(c.req.param("id"));
  return c.json({ ok: true });
});

api.get("/sessions/:id/messages", async (c) => {
  // opencode caps a page at 200; show the newest 200, oldest first.
  const res = await oc<{ data: any[] }>(`/api/session/${c.req.param("id")}/message`, { query: { limit: "200", order: "desc" } });
  return c.json(res.data.reverse());
});

api.post("/sessions/:id/prompt", async (c) => {
  const id = c.req.param("id");
  const { text, files = [] } = await c.req.json<{ text: string; files?: string[] }>();
  if (!text?.trim()) return c.json({ error: "empty prompt" }, 400);
  // Only paths that really are in the inbox can be attached.
  const attached = files.filter((f) => f.startsWith(INBOX_DIR + "/") && existsSync(f));
  const fullText = attached.length ? text + inboxNote(attached, HOME) : text;
  audit("prompt", id, { text: text.slice(0, 4000), ...(attached.length && { files: attached }) }, tailscaleUser(c) ?? "local");
  await setSessionContext(id, sessionContext(c));
  const res = await oc(`/api/session/${id}/prompt`, { method: "POST", body: { text: fullText } });
  return c.json(res);
});

api.post("/sessions/:id/interrupt", async (c) => {
  const id = c.req.param("id");
  audit("interrupt", id, {}, tailscaleUser(c) ?? "local");
  return c.json(await oc(`/api/session/${id}/interrupt`, { method: "POST" }));
});

api.post("/sessions/:id/model", async (c) => {
  const model = await c.req.json<ModelRef>();
  return c.json(await oc(`/api/session/${c.req.param("id")}/model`, { method: "POST", body: { model } }));
});

api.post("/sessions/:id/auto-approve", async (c) => {
  const id = c.req.param("id");
  const { enabled } = await c.req.json<{ enabled: boolean }>();
  if (enabled) autoApprove.add(id);
  else autoApprove.delete(id);
  audit("auto-approve", id, { enabled }, tailscaleUser(c) ?? "local");
  broadcast("lazylink.auto-approve", { sessionID: id, enabled });
  return c.json({ enabled });
});

api.get("/permissions", async (c) => {
  const res = await oc<{ data: any[] }>("/api/permission/request");
  return c.json(res.data);
});

api.post("/sessions/:id/permissions/:pid", async (c) => {
  const { id, pid } = c.req.param();
  const { decision, message } = await c.req.json<{ decision: "once" | "always" | "reject"; message?: string }>();
  audit("permission.decision", id, { permissionID: pid, decision }, tailscaleUser(c) ?? "local");
  return c.json(
    await oc(`/api/session/${id}/permission/${pid}/reply`, { method: "POST", body: { decision, ...(message && { message }) } }),
  );
});

api.get("/audit", (c) =>
  c.json(
    queryAudit({
      limit: Number(c.req.query("limit") ?? 100),
      before: c.req.query("before") ? Number(c.req.query("before")) : undefined,
      sessionId: c.req.query("sessionId") || undefined,
      kinds: c.req.query("kinds")?.split(",").filter(Boolean),
    }),
  ),
);

// ----- agent context: the user's profile and the agent's memory -----

const CONTEXT_FILES: Record<string, string> = { profile: PROFILE_FILE, memory: MEMORY_FILE };

api.get("/context/:which", (c) => {
  const file = CONTEXT_FILES[c.req.param("which")];
  return file ? c.json({ text: readFileSync(file, "utf8") }) : c.notFound();
});

api.put("/context/:which", async (c) => {
  const which = c.req.param("which");
  const file = CONTEXT_FILES[which];
  if (!file) return c.notFound();
  const { text } = await c.req.json<{ text: string }>();
  if (typeof text !== "string" || text.length > 50_000) return c.json({ error: "text must be under 50k characters" }, 400);
  writeFileSync(file, text, { mode: 0o600 });
  audit(`context.${which}`, null, { chars: text.length }, tailscaleUser(c) ?? "local");
  return c.json({ ok: true });
});

// ----- files from the phone -----

const MAX_UPLOAD = 500 * 1024 * 1024;

async function uniquePath(dir: string, name: string) {
  const safe = basename(name).replace(/[^\w.\- ()]/g, "_").replace(/^\.+/, "") || "file";
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = join(dir, safe);
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

api.post("/upload", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const files = [body.files ?? body.file].flat().filter((f): f is File => f instanceof File);
  if (!files.length) return c.json({ error: "no files" }, 400);
  if (files.some((f) => f.size > MAX_UPLOAD)) return c.json({ error: "each file must be under 500 MB" }, 413);
  const dir = join(INBOX_DIR, new Date().toISOString().slice(0, 10));
  await mkdir(dir, { recursive: true });
  const saved: { path: string; name: string; size: number }[] = [];
  for (const f of files) {
    const path = await uniquePath(dir, f.name);
    await writeFile(path, Buffer.from(await f.arrayBuffer()));
    saved.push({ path, name: basename(path), size: f.size });
  }
  audit("file.uploaded", null, { files: saved }, tailscaleUser(c) ?? "local");
  return c.json(saved);
});

// ----- push notifications -----

api.get("/push/key", (c) => c.json({ key: vapidPublicKey, subscriptions: subscriptionCount() }));
api.post("/push/subscribe", async (c) => {
  pushSubscribe(await c.req.json(), c.req.header("user-agent"));
  audit("push.subscribed", null, { userAgent: c.req.header("user-agent") }, tailscaleUser(c) ?? "local");
  return c.json({ ok: true });
});
api.post("/push/unsubscribe", async (c) => {
  const { endpoint } = await c.req.json<{ endpoint: string }>();
  pushUnsubscribe(endpoint);
  return c.json({ ok: true });
});
api.post("/push/test", async (c) =>
  c.json({ sent: await push({ title: "lazylink", body: "Notifications work. Your Mac will ping you here.", tag: "test", url: "/" }, { force: true }) }),
);
/** The app pings this while it's on screen, so we don't send pushes the user is already looking at. */
api.post("/presence", (c) => (markVisible(), c.json({ ok: true })));

// ----- quick actions -----

api.post("/quick/:action", async (c) => {
  const action = c.req.param("action");
  const fn = QUICK_ACTIONS[action];
  if (!fn) return c.json({ error: "unknown action" }, 404);
  const { arg } = await c.req.json<{ arg?: string }>().catch(() => ({ arg: undefined }));
  try {
    const result = await fn(arg);
    audit(`quick.${action}`, null, { arg, result: result.text?.slice(0, 500) ?? result.url }, tailscaleUser(c) ?? "local");
    return c.json(result);
  } catch (err) {
    audit(`quick.${action}`, null, { arg, error: (err as Error).message }, tailscaleUser(c) ?? "local");
    return c.json({ error: (err as Error).message }, 500);
  }
});

api.get("/chrome", async (c) => c.json(await chromeStatus()));
api.post("/chrome/start", async (c) => c.json(await startChrome()));

api.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const send: Listener = (e) => void stream.writeSSE({ data: JSON.stringify(e) });
    listeners.add(send);
    send({ type: "lazylink.hello", data: { events: eventsConnected } });
    const heartbeat = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 15_000);
    await new Promise<void>((resolve) => stream.onAbort(resolve));
    clearInterval(heartbeat);
    listeners.delete(send);
  }),
);

app.route("/api", api);

// lazylink's own MCP server, used by opencode (bearer token, not the browser cookie).
app.all("/mcp", async (c) => {
  if (c.req.header("authorization") !== `Bearer ${config.mcpToken}`) return c.json({ error: "unauthorized" }, 401);
  return handleMcp(c.req.raw);
});

// The service worker normally handles Android share-sheet POSTs; if it isn't active yet, just open the app.
app.post("/share", (c) => c.redirect("/?shared=1", 303));

// Download links made by share_file. Still behind login, and they expire.
app.get("/files/:token/:name", requireAuth, async (c) => {
  const share = getShare(c.req.param("token") ?? "");
  if (!share) return c.json({ error: "link not found" }, 404);
  if (share.expires < Date.now()) return c.json({ error: "this link has expired; ask your Mac to share it again" }, 410);
  if (!existsSync(share.path)) return c.json({ error: "the file no longer exists on the Mac" }, 410);
  countDownload(share.token);
  audit("file.downloaded", null, { path: share.path, name: share.name }, tailscaleUser(c) ?? "local");
  const stream = Readable.toWeb(createReadStream(share.path)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(statSync(share.path).size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(share.name)}`,
      "cache-control": "private, no-store",
    },
  });
});

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

async function sendFile(c: Context, file: string, cache: string) {
  const body = await readFile(file);
  return c.body(body, 200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": cache });
}

// Screenshots and other media the agent produced (auth required).
app.get("/media/:file", requireAuth, async (c) => {
  const file = join(MEDIA_DIR, basename(c.req.param("file") ?? ""));
  if (!existsSync(file)) return c.notFound();
  return sendFile(c, file, "private, max-age=86400");
});

// The PWA (built with `npm run build`), with SPA fallback to index.html.
const webRoot = join(ROOT, "apps/web/dist");
app.get("*", async (c) => {
  if (!existsSync(webRoot)) return c.text("lazylink server is running. Build the web app with `npm run build`, or use `npm run dev`.");
  const path = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(webRoot, path);
  if (file.startsWith(webRoot) && existsSync(file) && statSync(file).isFile()) {
    return sendFile(c, file, path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  }
  return sendFile(c, join(webRoot, "index.html"), "no-cache");
});

// ---------- boot ----------

startOpencode();
subscribeEvents(onOpencodeEvent, (connected) => {
  if (connected === eventsConnected) return;
  eventsConnected = connected;
  console.log(`[opencode] event stream ${connected ? "connected" : "disconnected"}`);
  broadcast("lazylink.status", { events: connected });
});
pruneShares();
setInterval(pruneShares, 60 * 60 * 1000);
if (config.chrome.mode === "auto") {
  void startChrome().then((r) => console.log(`[chrome] ${r.running ? "agent Chrome ready" : r.error}`));
}

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[lazylink] listening on http://${config.host}:${info.port} (agent workdir: ${config.workdir})`);
  if (config.host !== "127.0.0.1" && config.host !== "localhost") {
    console.warn("[lazylink] WARNING: not bound to localhost. Expose lazylink only through `tailscale serve`.");
  }
});
