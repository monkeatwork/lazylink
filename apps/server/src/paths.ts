// Paths the agent may never touch through lazylink's own tools (share_file etc.).
// opencode.jsonc enforces the same list for opencode's built-in tools.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR, HOME, MEDIA_DIR } from "./config.ts";

const DENIED = [
  `${HOME}/.ssh`,
  `${HOME}/Library/Keychains`,
  `${HOME}/Library/Application Support/zen`,
  `${HOME}/.gnupg`,
  `${HOME}/.aws`,
  DATA_DIR, // lazylink's secrets, audit log, agent Chrome profile
];

/** Expands ~ and resolves symlinks. Throws if the path doesn't exist. */
export function resolveUserPath(p: string): string {
  const expanded = p.startsWith("~") ? HOME + p.slice(1) : p;
  return realpathSync(resolve(HOME, expanded));
}

export function isDenied(absPath: string): boolean {
  if (absPath.startsWith(MEDIA_DIR + "/")) return false; // screenshots are meant to be shared
  return DENIED.some((d) => absPath === d || absPath.startsWith(d + "/"));
}
