// Manages the agent's own Chrome: a dedicated profile with remote debugging, which Playwright MCP
// attaches to over CDP. Chrome refuses remote debugging on your default profile, and keeping the agent
// in its own profile means it only ever sees the accounts you deliberately logged in to there.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { config } from "./config.ts";

const cdpUrl = `http://127.0.0.1:${config.chrome.port}/json/version`;

export async function chromeStatus(): Promise<{ running: boolean; installed: boolean; browser?: string }> {
  const installed = existsSync(config.chrome.bin);
  try {
    const res = await fetch(cdpUrl, { signal: AbortSignal.timeout(1500) });
    const info = (await res.json()) as { Browser?: string };
    return { running: true, installed, browser: info.Browser };
  } catch {
    return { running: false, installed };
  }
}

export async function startChrome(): Promise<{ running: boolean; error?: string }> {
  const status = await chromeStatus();
  if (status.running) return { running: true };
  if (!status.installed) return { running: false, error: `Chrome not found at ${config.chrome.bin} (set LAZYLINK_CHROME_BIN)` };
  mkdirSync(config.chrome.profileDir, { recursive: true });
  const child = spawn(
    config.chrome.bin,
    [
      `--remote-debugging-port=${config.chrome.port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${config.chrome.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if ((await chromeStatus()).running) return { running: true };
  }
  return { running: false, error: "Chrome started but the debugging port never came up" };
}
