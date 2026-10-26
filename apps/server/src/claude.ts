// Start Claude Code sessions on the Mac with Remote Control on, so they can be driven from the
// Claude app or claude.ai/code. Each one opens in a WezTerm tab (visible when you're back at the Mac),
// falling back to Terminal.app. No model involved: the phone picks a folder and new/continue/resume.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { sh } from "@lazylink/mac-tools-mcp/mac";
import { HOME } from "./config.ts";
import { isDenied } from "./paths.ts";

const CLAUDE_DIR = join(HOME, ".claude");
const WEZTERM = ["/opt/homebrew/bin/wezterm", "/usr/local/bin/wezterm", "/Applications/WezTerm.app/Contents/MacOS/wezterm"].find(
  existsSync,
);

/** `running`: open in a Claude Code process on the Mac; `remote`: that process has Remote Control on. */
export type ClaudeSession = { id: string; dir: string; title: string; updated: number; running: boolean; remote: boolean };
export type ClaudeProject = { dir: string; updated: number; sessions: number };

/** Reads up to `bytes` from the start (or end) of a file without loading it all; transcripts get big. */
function readPart(file: string, bytes: number, fromEnd = false): string {
  const size = statSync(file).size;
  const len = Math.min(bytes, size);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, len, fromEnd ? size - len : 0);
  } finally {
    closeSync(fd);
  }
  return buf.toString("utf8");
}

const jsonLines = (text: string) =>
  text.split("\n").flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return []; // partial line at a cut, or not JSON
    }
  });

type Live = { name?: string; remote: boolean };

/** Live sessions from ~/.claude/sessions/<pid>.json, keyed by session id. A `bridgeSessionId` means Remote Control is on. */
function liveSessions(): Map<string, Live> {
  const live = new Map<string, Live>();
  const dir = join(CLAUDE_DIR, "sessions");
  if (!existsSync(dir)) return live;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
      process.kill(s.pid, 0); // throws if the process is gone
      // The same session can be open in two processes; it counts as remote if either has Remote Control.
      const remote = !!s.bridgeSessionId || !!live.get(s.sessionId)?.remote;
      live.set(s.sessionId, { name: s.name, remote });
    } catch {
      /* stale file */
    }
  }
  return live;
}

function describe(file: string, live: Map<string, Live>): ClaudeSession | undefined {
  const id = file
    .split("/")
    .pop()!
    .replace(/\.jsonl$/, "");
  const head = jsonLines(readPart(file, 64 * 1024));
  const firstUser = head.find((l) => l.type === "user" && l.cwd);
  if (!firstUser) return undefined; // empty or sidechain-only transcript
  const tail = jsonLines(readPart(file, 128 * 1024, true));
  const titled = [...tail].reverse().find((l) => l.type === "custom-title" || l.type === "ai-title");
  const prompt = typeof firstUser.message?.content === "string" ? firstUser.message.content : "";
  const title = live.get(id)?.name || titled?.customTitle || titled?.aiTitle || prompt.slice(0, 80) || "Untitled";
  return { id, dir: firstUser.cwd, title, updated: statSync(file).mtimeMs, running: live.has(id), remote: !!live.get(id)?.remote };
}

/** Recent sessions, newest first, optionally only those started in `dir`. */
export function listClaudeSessions(dir?: string, limit = 15): ClaudeSession[] {
  const root = join(CLAUDE_DIR, "projects");
  if (!existsSync(root)) return [];
  const live = liveSessions();
  const folders = dir
    ? [dir.replace(/[^a-zA-Z0-9]/g, "-")]
    : readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
  const files = folders
    .flatMap((f) => {
      const p = join(root, f);
      return existsSync(p) && statSync(p).isDirectory()
        ? readdirSync(p)
            .filter((n) => n.endsWith(".jsonl"))
            .map((n) => join(p, n))
        : [];
    })
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const out: ClaudeSession[] = [];
  for (const { file } of files) {
    if (out.length >= limit) break;
    const s = describe(file, live);
    if (s && (!dir || s.dir === dir)) out.push(s);
  }
  return out;
}

/** Folders you've used Claude Code in, most recent first, for the folder picker. */
export function listClaudeProjects(limit = 12): ClaudeProject[] {
  const byDir = new Map<string, ClaudeProject>();
  for (const s of listClaudeSessions(undefined, 60)) {
    const p = byDir.get(s.dir);
    if (p) p.sessions++;
    else byDir.set(s.dir, { dir: s.dir, updated: s.updated, sessions: 1 });
  }
  return [...byDir.values()].filter((p) => existsSync(p.dir)).slice(0, limit);
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type StartClaude = { dir: string; mode: "new" | "continue" | "resume"; sessionId?: string; create?: boolean };

/** Opens a terminal tab in `dir` running Claude Code with Remote Control on. */
export async function startClaude({ dir, mode, sessionId, create }: StartClaude) {
  const abs = resolve(HOME, dir.replace(/^~(?=\/|$)/, HOME));
  if (!abs.startsWith(HOME + "/") || isDenied(abs)) throw new Error(`Not allowed: ${abs}`);
  if (!existsSync(abs)) {
    if (!create) throw new Error(`${abs} doesn't exist`);
    mkdirSync(abs, { recursive: true });
  }
  const latest = listClaudeSessions(abs, 1)[0];
  if (mode === "resume" && !/^[\w-]{8,}$/.test(sessionId ?? "")) throw new Error("Pick a session to resume");
  if (mode === "continue" && !latest) throw new Error("No earlier session in this folder to continue");
  // Opening a session that's already running would start a second copy of it; say where it already is.
  const target = mode === "continue" ? latest : mode === "resume" ? listClaudeSessions(abs, 50).find((x) => x.id === sessionId) : undefined;
  if (target?.running) throw new AlreadyOpen(target);

  const args = ["--remote-control", ...(mode === "continue" ? ["--continue"] : mode === "resume" ? ["--resume", sessionId!] : [])];
  // A login shell, so claude finds node and your PATH; the tab stays open after claude exits.
  const command = `claude ${args.map(shellQuote).join(" ")}; exec $SHELL -l`;
  const shell = process.env.SHELL || "/bin/zsh";

  let where = "WezTerm";
  let pane: string | undefined;
  if (WEZTERM) {
    pane = (await sh(WEZTERM, ["cli", "spawn", "--cwd", abs, "--", shell, "-lc", command]).catch(() => "")).trim() || undefined;
    if (pane) await sh("open", ["-a", "WezTerm"]).catch(() => {});
    else {
      // WezTerm isn't running: start it with this as its first window, then find the pane.
      spawn(WEZTERM, ["start", "--cwd", abs, "--", shell, "-lc", command], { detached: true, stdio: "ignore" }).unref();
      for (let i = 0; i < 20 && !pane; i++) {
        await sleep(500);
        pane = await findPane(abs).catch(() => undefined);
      }
    }
  } else {
    where = "Terminal";
    const script = `cd ${shellQuote(abs)} && ${command}`;
    await sh("osascript", [
      "-e",
      `tell application "Terminal" to do script ${JSON.stringify(script)}`,
      "-e",
      'tell application "Terminal" to activate',
    ]);
  }
  const what = mode === "new" ? "New Claude Code session" : mode === "continue" ? "Continued the latest session" : "Resumed the session";
  return {
    dir: abs,
    where,
    pane,
    text: `${what} in ${abs.replace(HOME, "~")} (${where}), with Remote Control on. It shows up in the Claude app under Code in a few seconds.`,
  };
}

export class AlreadyOpen extends Error {
  constructor(public session: ClaudeSession) {
    super(
      `"${session.title}" is already open on the Mac` +
        (session.remote
          ? " with Remote Control on. Open it from the Claude app (Code tab)."
          : " without Remote Control. Type /rc in it at the Mac, or quit it there first."),
    );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The newest WezTerm pane whose working directory is `dir`. */
async function findPane(dir: string): Promise<string | undefined> {
  const panes: { pane_id: number; cwd?: string }[] = JSON.parse(await sh(WEZTERM!, ["cli", "list", "--format", "json"]));
  const match = panes
    .filter((p) =>
      decodeURIComponent(p.cwd ?? "")
        .replace(/\/$/, "")
        .endsWith(dir),
    )
    .at(-1);
  return match ? String(match.pane_id) : undefined;
}

export type PaneState = "starting" | "trust" | "ready" | "gone";

/** What a launched Claude Code tab is showing, so the phone can follow along. */
export async function paneState(pane: string): Promise<PaneState> {
  if (!WEZTERM || !/^\d+$/.test(pane)) return "gone";
  const screen = await sh(WEZTERM, ["cli", "get-text", "--pane-id", pane]).catch(() => undefined);
  if (screen === undefined) return "gone";
  if (screen.includes("Yes, I trust this folder")) return "trust";
  if (screen.includes("/remote-control is active")) return "ready";
  return "starting";
}

/** WezTerm tabs currently waiting at the "trust this folder" prompt, e.g. ones the agent opened. */
export async function pendingTrust(): Promise<{ pane: string; dir: string }[]> {
  if (!WEZTERM) return [];
  const panes: { pane_id: number; cwd?: string }[] = JSON.parse(await sh(WEZTERM, ["cli", "list", "--format", "json"]).catch(() => "[]"));
  const out: { pane: string; dir: string }[] = [];
  for (const p of panes) {
    if ((await paneState(String(p.pane_id))) === "trust")
      out.push({ pane: String(p.pane_id), dir: decodeURIComponent((p.cwd ?? "").replace(/^file:\/\/[^/]*/, "")).replace(/\/$/, "") });
  }
  return out;
}

/**
 * Answers Claude Code's "Do you trust this folder?" prompt with "Yes", when the user taps
 * "Trust this folder" on their phone. The prompt defaults to "No, exit", so it's Down then Enter.
 * Does nothing unless that prompt is what the tab is showing.
 */
export async function trustFolder(pane: string): Promise<PaneState> {
  if ((await paneState(pane)) !== "trust") throw new Error("That tab isn't asking about trusting the folder.");
  await sh(WEZTERM!, ["cli", "send-text", "--no-paste", "--pane-id", pane], "\x1b[B");
  await sleep(300);
  await sh(WEZTERM!, ["cli", "send-text", "--no-paste", "--pane-id", pane], "\r");
  await sleep(1500);
  return paneState(pane);
}
