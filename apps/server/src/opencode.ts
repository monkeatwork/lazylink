// Runs `opencode serve` as a supervised child process and talks to its v2 HTTP API.
// The installed opencode (v2.x) exposes an experimental /api/* surface that is ahead of the
// published @opencode-ai/sdk, so we use a tiny typed fetch client for the handful of routes we need.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, DATA_DIR, HOME, MEDIA_DIR, ROOT } from "./config.ts";

export type OpencodeEvent = { id: string; type: string; created?: number; data: any };

const baseUrl = config.opencode.url || `http://127.0.0.1:${config.opencode.port}`;
const authHeader = "Basic " + Buffer.from(`opencode:${config.opencode.password}`).toString("base64");

export class OpencodeError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`opencode ${status}: ${body.slice(0, 300)}`);
  }
}

export async function oc<T = any>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}): Promise<T> {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: authHeader, ...(init.body !== undefined && { "content-type": "application/json" }) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new OpencodeError(res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Builds the opencode config lazylink runs with, from opencode.jsonc (or the example) in the repo. */
function writeOpencodeConfig(): string {
  const source = [join(ROOT, "opencode.jsonc"), join(ROOT, "opencode.example.jsonc")].find(existsSync);
  if (!source) throw new Error("No opencode.jsonc or opencode.example.jsonc found in the repo root.");
  const vars: Record<string, string> = {
    LAZYLINK_ROOT: ROOT,
    LAZYLINK_MEDIA_DIR: MEDIA_DIR,
    LAZYLINK_DATA_DIR: DATA_DIR,
    LAZYLINK_PORT: String(config.port),
    LAZYLINK_MCP_TOKEN: config.mcpToken,
    HOME,
    CHROME_PORT: String(config.chrome.port),
  };
  const rendered = readFileSync(source, "utf8").replace(/\$\{(\w+)\}/g, (m, name) => vars[name] ?? m);
  const target = join(DATA_DIR, "opencode.jsonc");
  writeFileSync(target, rendered, { mode: 0o600 });
  chmodSync(target, 0o600); // contains the MCP bearer token
  return target;
}

let child: ChildProcess | undefined;
let stopping = false;

export function startOpencode() {
  if (config.opencode.url) {
    console.log(`[opencode] using external server at ${config.opencode.url}`);
    return;
  }
  const configFile = writeOpencodeConfig();
  const logFile = join(DATA_DIR, "opencode.log");
  const log = createWriteStream(logFile, { flags: "a", mode: 0o600 });
  if (existsSync(logFile)) chmodSync(logFile, 0o600);
  let backoff = 1000;

  const launch = () => {
    console.log(`[opencode] starting ${config.opencode.bin} serve on :${config.opencode.port}`);
    const startedAt = Date.now();
    child = spawn(config.opencode.bin, ["serve", "--hostname", "127.0.0.1", "--port", String(config.opencode.port)], {
      cwd: config.workdir,
      env: { ...process.env, OPENCODE_CONFIG: configFile, OPENCODE_SERVER_PASSWORD: config.opencode.password },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.on("exit", (code, signal) => {
      child = undefined;
      if (stopping) return;
      if (Date.now() - startedAt > 60_000) backoff = 1000;
      console.error(`[opencode] exited (${code ?? signal}); restarting in ${backoff / 1000}s. See ~/.lazylink/opencode.log`);
      setTimeout(launch, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    });
  };
  launch();

  const stop = () => {
    stopping = true;
    child?.kill("SIGTERM");
  };
  process.on("exit", stop);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stop(), process.exit(0)));
}

export async function opencodeHealthy(): Promise<boolean> {
  try {
    await oc("/api/info");
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribes to opencode's global SSE event stream forever (reconnecting on failure)
 * and hands every event to `onEvent`. `onStatus` reports connectivity changes.
 */
export function subscribeEvents(onEvent: (e: OpencodeEvent) => void, onStatus: (connected: boolean) => void) {
  let backoff = 500;
  const loop = async () => {
    for (;;) {
      try {
        const res = await fetch(new URL("/api/event", baseUrl), { headers: { authorization: authHeader, accept: "text/event-stream" } });
        if (!res.ok || !res.body) throw new Error(`event stream ${res.status}`);
        onStatus(true);
        backoff = 500;
        const decoder = new TextDecoder();
        let buf = "";
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buf += decoder.decode(chunk, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            try {
              onEvent(JSON.parse(data));
            } catch {
              /* ignore malformed frames */
            }
          }
        }
        throw new Error("event stream ended");
      } catch {
        onStatus(false);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 10_000);
      }
    }
  };
  void loop();
}

/**
 * Per-session context that changes over time (date, device, latest memory). opencode's instruction files are
 * read once, so this keeps memory edits effective immediately. Uses an experimental opencode route; failures
 * are non-fatal because the static instruction files already carry the essentials.
 */
export async function setSessionContext(sessionId: string, text: string) {
  try {
    await oc(`/api/experimental/session/${sessionId}/instructions/entries/lazylink-session`, { method: "PUT", body: { value: text } });
  } catch (err) {
    console.warn("[opencode] could not set session context:", (err as Error).message.slice(0, 200));
  }
}
