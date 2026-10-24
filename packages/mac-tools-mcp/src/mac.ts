// Shared macOS helpers used by the mac-tools MCP server and lazylink's quick actions.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const TIMEOUT_MS = 30_000;

export const MEDIA_DIR = process.env.LAZYLINK_MEDIA_DIR ?? join(homedir(), ".lazylink", "media");

export async function sh(cmd: string, args: string[], input?: string): Promise<string> {
  if (input === undefined) {
    const { stdout } = await run(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trimEnd();
  }
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: TIMEOUT_MS }, (err, stdout) => (err ? reject(err) : resolve(stdout.trimEnd())));
    child.stdin?.end(input);
  });
}

export function osascript(script: string, language: "applescript" | "javascript" = "applescript") {
  const args = language === "javascript" ? ["-l", "JavaScript", "-e", script] : ["-e", script];
  return sh("osascript", args);
}

/** Captures the screen (or the frontmost window) into MEDIA_DIR. Returns the full-size and downscaled paths. */
export async function screenshot(opts: { display?: number; window?: boolean; mediaDir?: string } = {}) {
  const dir = opts.mediaDir ?? MEDIA_DIR;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `screenshot-${Date.now()}.png`);
  const args = ["-x", "-t", "png"];
  if (opts.display) args.push("-D", String(opts.display));
  if (opts.window) {
    const id = await osascript(
      'tell application "System Events" to get id of first window of (first process whose frontmost is true)',
    ).catch(() => "");
    if (id) args.push("-l", id);
  }
  await sh("screencapture", [...args, file]).catch((err) => {
    if (/could not create image/i.test(String(err?.stderr ?? err?.message)))
      throw new Error(
        "macOS blocked the screenshot. On the Mac, open System Settings → Privacy & Security → Screen Recording and allow the app running lazylink (Terminal, or node when it runs in the background), then try again.",
      );
    throw err;
  });
  // A downscaled copy for models, so screenshots don't blow the context window.
  const small = file.replace(/\.png$/, ".small.png");
  await sh("sips", ["-Z", "1440", file, "--out", small]);
  return { file, small };
}

export async function systemInfo(): Promise<string> {
  const parts = await Promise.all([
    sh("sw_vers", []).catch(() => ""),
    sh("uptime", []).catch(() => ""),
    sh("pmset", ["-g", "batt"]).catch(() => ""),
    sh("df", ["-h", "/"]).catch(() => ""),
  ]);
  return parts.filter(Boolean).join("\n\n");
}
