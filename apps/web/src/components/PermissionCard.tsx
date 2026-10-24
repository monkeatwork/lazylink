import { useState } from "react";
import type { PermissionRequest } from "../api.ts";

const DESCRIBE: Record<string, string> = {
  shell: "Run a command",
  edit: "Change a file",
  write: "Write a file",
  read: "Read a file",
  external_directory: "Access a folder outside the workspace",
  webfetch: "Fetch a web page",
};

function describe(action: string) {
  if (DESCRIBE[action]) return DESCRIBE[action];
  const [server, ...rest] = action.split("_");
  if (server === "playwright") return `Browser: ${rest.join(" ").replace(/^browser /, "")}`;
  if (server === "macos") return `Mac: ${rest.join(" ")}`;
  return action;
}

export function PermissionCard({
  req,
  onReply,
}: {
  req: PermissionRequest;
  onReply: (decision: "once" | "always" | "reject") => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const reply = async (d: "once" | "always" | "reject") => {
    setBusy(true);
    try {
      await onReply(d);
    } finally {
      setBusy(false);
    }
  };
  const resources = req.resources.filter((r) => r !== "*");
  return (
    <div className="permission">
      <div className="permission-title">
        <span className="warn-icon">!</span> {describe(req.action)}
      </div>
      {resources.length > 0 && <pre className="mono">{resources.join("\n")}</pre>}
      {req.message && <div className="muted">{req.message}</div>}
      <div className="permission-actions">
        <button className="btn danger" disabled={busy} onClick={() => reply("reject")}>
          Deny
        </button>
        {req.save && req.save.length > 0 && (
          <button className="btn" disabled={busy} onClick={() => reply("always")} title={`Always allow: ${req.save.join(", ")}`}>
            Always
          </button>
        )}
        <button className="btn primary" disabled={busy} onClick={() => reply("once")}>
          Allow
        </button>
      </div>
      {req.save && req.save.length > 0 && <div className="muted tiny">“Always” allows: {req.save.join(", ")}</div>}
    </div>
  );
}
