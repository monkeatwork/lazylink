import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { audit, auditEvent, recentAudit } from "./audit.ts";
import { authStatus, login, logout, requireAuth, tailscaleUser } from "./auth.ts";
import { chromeStatus, startChrome } from "./chrome.ts";
import { config, MEDIA_DIR, ROOT } from "./config.ts";
import { oc, OpencodeError, opencodeHealthy, startOpencode, subscribeEvents, type OpencodeEvent } from "./opencode.ts";

// ---------- event hub: opencode SSE → every connected browser ----------

type Listener = (e: { type: string; data: unknown }) => void;
const listeners = new Set<Listener>();
const broadcast = (type: string, data: unknown) => listeners.forEach((l) => l({ type, data }));

/** Sessions where the user flipped "auto-approve": permission asks are answered "once" automatically. */
const autoApprove = new Set<string>();
let eventsConnected = false;

function onOpencodeEvent(e: OpencodeEvent) {
  auditEvent(e);
  if (e.type === "permission.asked" && autoApprove.has(e.data?.sessionID)) {
    audit("permission.auto-approved", e.data.sessionID, { action: e.data.action, resources: e.data.resources }, "lazylink");
    void oc(`/api/session/${e.data.sessionID}/permission/${e.data.id}/reply`, { method: "POST", body: { decision: "once" } }).catch(
      (err) => console.error("[auto-approve]", err.message),
    );
  }
  if (e.type.startsWith("session.") || e.type.startsWith("permission.")) broadcast(e.type, e.data);
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
    .filter((m) => m.capabilities?.tools !== false)
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
    })),
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
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: "empty prompt" }, 400);
  audit("prompt", id, { text: text.slice(0, 4000) }, tailscaleUser(c) ?? "local");
  const res = await oc(`/api/session/${id}/prompt`, { method: "POST", body: { text } });
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

api.get("/audit", (c) => c.json(recentAudit(Number(c.req.query("limit") ?? 200))));

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
if (config.chrome.mode === "auto") {
  void startChrome().then((r) => console.log(`[chrome] ${r.running ? "agent Chrome ready" : r.error}`));
}

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[lazylink] listening on http://${config.host}:${info.port} (agent workdir: ${config.workdir})`);
  if (config.host !== "127.0.0.1" && config.host !== "localhost") {
    console.warn("[lazylink] WARNING: not bound to localhost. Expose lazylink only through `tailscale serve`.");
  }
});
