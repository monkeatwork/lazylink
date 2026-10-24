// Append-only audit log of everything the agent did or was asked to do (node:sqlite, no native deps).
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./config.ts";
import type { OpencodeEvent } from "./opencode.ts";

const db = new DatabaseSync(join(DATA_DIR, "audit.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    session_id TEXT,
    actor TEXT,
    detail TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
`);

const insert = db.prepare("INSERT INTO audit (ts, kind, session_id, actor, detail) VALUES (?, ?, ?, ?, ?)");

export function audit(kind: string, sessionId: string | null, detail: unknown, actor: string | null = null) {
  insert.run(Date.now(), kind, sessionId, actor, JSON.stringify(detail));
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

export function recentAudit(limit = 200) {
  return db
    .prepare("SELECT id, ts, kind, session_id AS sessionId, actor, detail FROM audit ORDER BY id DESC LIMIT ?")
    .all(limit)
    .map((r: any) => ({ ...r, detail: JSON.parse(r.detail) }));
}
