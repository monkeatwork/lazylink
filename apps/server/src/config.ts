import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const HOME = homedir();
export const DATA_DIR = process.env.LAZYLINK_DATA_DIR ?? join(HOME, ".lazylink");
export const MEDIA_DIR = join(DATA_DIR, "media");
mkdirSync(MEDIA_DIR, { recursive: true });

loadDotEnv(join(ROOT, ".env"));

/** Minimal .env loader so launchd/`npm start` behave the same without extra deps. */
function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/** A secret persisted in DATA_DIR, generated on first use. */
function persistentSecret(name: string): string {
  const file = join(DATA_DIR, name);
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const value = randomBytes(32).toString("base64url");
  writeFileSync(file, value + "\n", { mode: 0o600 });
  return value;
}

const env = process.env;

export const config = {
  host: env.LAZYLINK_HOST ?? "127.0.0.1",
  port: Number(env.LAZYLINK_PORT ?? 8787),
  /** Required. The passcode you type on your phone to unlock lazylink. */
  passcode: env.LAZYLINK_PASSCODE ?? "",
  /** Comma-separated Tailscale logins allowed in (e.g. you@gmail.com). Empty = any tailnet user. */
  allowedUsers: (env.LAZYLINK_ALLOWED_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /** Directory the agent works in. Your home folder by default, so it can reach "every file". */
  workdir: resolve(env.LAZYLINK_WORKDIR ?? HOME),
  /** Default model as provider/model, e.g. opencode/nemotron-3-ultra-free or ollama/qwen3-coder. */
  defaultModel: env.LAZYLINK_MODEL ?? "",
  sessionSecret: persistentSecret("session.secret"),

  opencode: {
    bin: env.OPENCODE_BIN ?? (existsSync(join(HOME, ".opencode/bin/opencode")) ? join(HOME, ".opencode/bin/opencode") : "opencode"),
    port: Number(env.OPENCODE_PORT ?? 4096),
    /** Set OPENCODE_URL to use an opencode server you run yourself instead of letting lazylink spawn one. */
    url: env.OPENCODE_URL ?? "",
    password: env.OPENCODE_SERVER_PASSWORD ?? persistentSecret("opencode.password"),
  },

  chrome: {
    bin: env.LAZYLINK_CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    port: Number(env.LAZYLINK_CHROME_PORT ?? 9222),
    profileDir: join(DATA_DIR, "chrome"),
    /** "auto" starts the agent Chrome with lazylink; "manual" waits for the Start button. */
    mode: env.LAZYLINK_CHROME ?? "auto",
  },
};

if (!config.passcode || config.passcode.length < 8) {
  console.error("LAZYLINK_PASSCODE must be set (8+ characters). Copy .env.example to .env and fill it in.");
  process.exit(1);
}
