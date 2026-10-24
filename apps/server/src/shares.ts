// Private, expiring download links for files on the Mac (created by the agent's share_file tool).
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { isDenied, resolveUserPath } from "./paths.ts";

const run = promisify(execFile);
const ZIP_DIR = join(tmpdir(), "lazylink-shares");
const MAX_FOLDER_BYTES = 2 * 1024 * 1024 * 1024;

export type Share = { token: string; path: string; name: string; size: number; created: number; expires: number; downloads: number; temp: number };

export const shareUrl = (s: Pick<Share, "token" | "name">) => `/files/${s.token}/${encodeURIComponent(s.name)}`;

export async function createShare(inputPath: string): Promise<Share> {
  let path: string;
  try {
    path = resolveUserPath(inputPath);
  } catch {
    throw new Error(`No such file or folder: ${inputPath}`);
  }
  if (isDenied(path)) throw new Error(`Sharing ${path} is not allowed.`);

  let st = statSync(path);
  let name = basename(path);
  let temp = 0;
  if (st.isDirectory()) {
    const { stdout } = await run("du", ["-sk", path]);
    if (Number(stdout.split("\t")[0]) * 1024 > MAX_FOLDER_BYTES) throw new Error("Folder is larger than 2 GB; share individual files instead.");
    mkdirSync(ZIP_DIR, { recursive: true, mode: 0o700 });
    const zip = join(ZIP_DIR, `${randomBytes(6).toString("hex")}-${name}.zip`);
    await run("ditto", ["-c", "-k", "--keepParent", path, zip], { timeout: 5 * 60_000 });
    path = zip;
    name = `${name}.zip`;
    st = statSync(zip);
    temp = 1;
  } else if (!st.isFile()) {
    throw new Error(`${path} is not a regular file.`);
  }

  const now = Date.now();
  const share: Share = {
    token: randomBytes(18).toString("base64url"),
    path,
    name,
    size: st.size,
    created: now,
    expires: now + config.shareTtlMs,
    downloads: 0,
    temp,
  };
  db.prepare("INSERT INTO shares (token, path, name, size, created, expires, downloads, temp) VALUES (?, ?, ?, ?, ?, ?, 0, ?)").run(
    share.token, share.path, share.name, share.size, share.created, share.expires, share.temp,
  );
  return share;
}

export function getShare(token: string): Share | undefined {
  return db.prepare("SELECT * FROM shares WHERE token = ?").get(token) as Share | undefined;
}

export function countDownload(token: string) {
  db.prepare("UPDATE shares SET downloads = downloads + 1 WHERE token = ?").run(token);
}

/** Deletes expired shares and the zips made for them. */
export function pruneShares() {
  const expired = db.prepare("SELECT * FROM shares WHERE expires < ?").all(Date.now()) as Share[];
  for (const s of expired) if (s.temp) rmSync(s.path, { force: true });
  db.prepare("DELETE FROM shares WHERE expires < ?").run(Date.now());
}
