// Web Push to the installed PWA: approvals needed, tasks finished, and the agent's notify_phone tool.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import webpush, { type PushSubscription } from "web-push";
import { DATA_DIR } from "./config.ts";
import { db } from "./db.ts";

const VAPID_FILE = join(DATA_DIR, "vapid.json");

function vapidKeys(): { publicKey: string; privateKey: string } {
  if (existsSync(VAPID_FILE)) return JSON.parse(readFileSync(VAPID_FILE, "utf8"));
  const keys = webpush.generateVAPIDKeys();
  writeFileSync(VAPID_FILE, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

const keys = vapidKeys();
// The subject is only used by push services to contact the sender about abuse; it never leaves the request.
webpush.setVapidDetails("mailto:lazylink@localhost", keys.publicKey, keys.privateKey);

export const vapidPublicKey = keys.publicKey;

export function subscribe(sub: PushSubscription, userAgent: string | undefined) {
  db.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription, user_agent, created) VALUES (?, ?, ?, ?)").run(
    sub.endpoint, JSON.stringify(sub), userAgent ?? null, Date.now(),
  );
}

export function unsubscribe(endpoint: string) {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export const subscriptionCount = () => (db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n;

// ---------- presence: don't buzz the phone while the app is open on screen ----------

let lastVisible = 0;
export const markVisible = () => (lastVisible = Date.now());
const someoneLooking = () => Date.now() - lastVisible < 30_000;

export type PushPayload = {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other. */
  tag?: string;
  /** Path to open when tapped, e.g. /?session=ses_123 */
  url?: string;
};

/** Sends to every subscribed device. `force` sends even if the app is currently on screen. */
export async function push(payload: PushPayload, { force = false } = {}): Promise<number> {
  if (!force && someoneLooking()) return 0;
  const rows = db.prepare("SELECT endpoint, subscription FROM push_subscriptions").all() as { endpoint: string; subscription: string }[];
  let sent = 0;
  await Promise.all(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(JSON.parse(r.subscription), JSON.stringify(payload), { TTL: 60 * 60 });
        sent++;
      } catch (err: any) {
        // 404/410: the browser dropped this subscription.
        if (err?.statusCode === 404 || err?.statusCode === 410) unsubscribe(r.endpoint);
        else console.error("[push]", err?.statusCode ?? "", err?.body ?? err?.message);
      }
    }),
  );
  return sent;
}
