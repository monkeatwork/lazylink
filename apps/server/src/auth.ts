import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { config } from "./config.ts";

const COOKIE = "lazylink_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

const sign = (payload: string) => createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** `tailscale serve` adds this header with the visitor's tailnet login. */
export const tailscaleUser = (c: Context) => c.req.header("tailscale-user-login")?.toLowerCase();

function tailnetAllowed(c: Context) {
  const user = tailscaleUser(c);
  if (!user || config.allowedUsers.length === 0) return true;
  return config.allowedUsers.includes(user);
}

function validSession(c: Context) {
  const raw = getCookie(c, COOKIE);
  if (!raw) return false;
  const [expires, sig] = raw.split(".");
  return !!expires && !!sig && Number(expires) > Date.now() && safeEqual(sig, sign(expires));
}

export async function requireAuth(c: Context, next: Next) {
  if (!tailnetAllowed(c)) return c.json({ error: "tailnet user not allowed" }, 403);
  if (!validSession(c)) return c.json({ error: "unauthorized" }, 401);
  await next();
}

let failures = 0;
let lockedUntil = 0;

export async function login(c: Context) {
  if (!tailnetAllowed(c)) return c.json({ error: "tailnet user not allowed" }, 403);
  if (Date.now() < lockedUntil) return c.json({ error: "too many attempts, try again later" }, 429);
  const { passcode } = await c.req.json<{ passcode?: string }>().catch(() => ({ passcode: undefined }));
  if (!passcode || !safeEqual(passcode, config.passcode)) {
    if (++failures >= MAX_FAILURES) {
      lockedUntil = Date.now() + LOCKOUT_MS;
      failures = 0;
    }
    return c.json({ error: "wrong passcode" }, 401);
  }
  failures = 0;
  const expires = String(Date.now() + SESSION_TTL_MS);
  setCookie(c, COOKIE, `${expires}.${sign(expires)}`, {
    httpOnly: true,
    sameSite: "Strict",
    secure: c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.json({ ok: true, user: tailscaleUser(c) ?? null });
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}

export const authStatus = (c: Context) => c.json({ authenticated: tailnetAllowed(c) && validSession(c), user: tailscaleUser(c) ?? null });
