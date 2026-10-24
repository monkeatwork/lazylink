// One SQLite database (node:sqlite, no native deps) for the audit log, file shares and push subscriptions.
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./config.ts";

const file = join(DATA_DIR, "audit.db");
export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    session_id TEXT,
    actor TEXT,
    detail TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
  CREATE INDEX IF NOT EXISTS audit_session ON audit(session_id);
  CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    downloads INTEGER NOT NULL DEFAULT 0,
    temp INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    subscription TEXT NOT NULL,
    user_agent TEXT,
    created INTEGER NOT NULL
  );
`);

// The audit log records every command the agent ran: keep it readable by this user only.
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
