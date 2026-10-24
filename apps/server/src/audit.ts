// Append-only audit log of everything the agent did or was asked to do.
import { db } from "./db.ts";
import type { OpencodeEvent } from "./opencode.ts";

export type AuditEntry = { id: number; ts: number; kind: string; sessionId: string | null; actor: string | null; detail: any };

const insert = db.prepare("INSERT INTO audit (ts, kind, session_id, actor, detail) VALUES (?, ?, ?, ?, ?)");
const listeners = new Set<(e: AuditEntry) => void>();

/** Called with every new entry (the server relays them to the Activity screen). */
export const onAudit = (fn: (e: AuditEntry) => void) => listeners.add(fn);

export function audit(kind: string, sessionId: string | null, detail: unknown, actor: string | null = null) {
  const ts = Date.now();
  const json = JSON.stringify(detail);
  const { lastInsertRowid } = insert.run(ts, kind, sessionId, actor, json);
  const entry = { id: Number(lastInsertRowid), ts, kind, sessionId, actor, detail: JSON.parse(json) };
  listeners.forEach((l) => l(entry));
}

const AUDITED = new Set([
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "permission.asked",
  "permission.replied",
  "session.execution.failed",
]);

/** Records the security-relevant subset of opencode events. Tool output is truncated. */
export function auditEvent(e: OpencodeEvent) {
  if (!AUDITED.has(e.type)) return;
  const { sessionID, content, ...rest } = e.data ?? {};
  const detail = content ? { ...rest, output: JSON.stringify(content).slice(0, 2000) } : rest;
  audit(e.type, sessionID ?? null, detail, "agent");
}

/** Newest first. `before` is an id cursor; `kinds` matches exact kinds or prefixes ending in "." (e.g. "file."). */
export function queryAudit(opts: { limit?: number; before?: number; sessionId?: string; kinds?: string[] }): AuditEntry[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.before) (where.push("id < ?"), params.push(opts.before));
  if (opts.sessionId) (where.push("session_id = ?"), params.push(opts.sessionId));
  if (opts.kinds?.length) {
    where.push(`(${opts.kinds.map(() => "kind LIKE ?").join(" OR ")})`);
    params.push(...opts.kinds.map((k) => (k.endsWith(".") ? `${k}%` : k)));
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return db
    .prepare(
      `SELECT id, ts, kind, session_id AS sessionId, actor, detail FROM audit
       ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ${limit}`,
    )
    .all(...params)
    .map((r: any) => ({ ...r, detail: JSON.parse(r.detail) }));
}
