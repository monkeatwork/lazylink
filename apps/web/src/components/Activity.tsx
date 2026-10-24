import { useCallback, useEffect, useState } from "react";
import { api, type AuditEntry, type SessionInfo } from "../api.ts";
import { MCP_LABEL } from "./Messages.tsx";

const FILTERS: { id: string; label: string; kinds?: string[] }[] = [
  { id: "all", label: "All" },
  { id: "commands", label: "Commands", kinds: ["session.tool.called", "session.tool.failed"] },
  { id: "approvals", label: "Approvals", kinds: ["permission.asked", "permission.decision", "permission.auto-approved", "auto-approve"] },
  { id: "prompts", label: "Prompts", kinds: ["prompt", "session.created", "interrupt"] },
  { id: "files", label: "Files", kinds: ["file."] },
  { id: "quick", label: "Quick actions", kinds: ["quick."] },
  { id: "memory", label: "Memory", kinds: ["memory.", "context."] },
];

/** Rows that only repeat another row ("permission.replied" mirrors the decision; successes follow every call). */
const HIDDEN_IN_ALL = new Set(["session.tool.success", "permission.replied"]);

const matches = (e: AuditEntry, kinds?: string[]) =>
  kinds ? kinds.some((k) => (k.endsWith(".") ? e.kind.startsWith(k) : e.kind === k)) : !HIDDEN_IN_ALL.has(e.kind);

function codeCalls(code: string) {
  const calls = [...code.matchAll(/tools\.(\w+)(?:\.(\w+)|\[["'](\w+)["']\])?/g)].map((m) => {
    const key = m[2] || m[3] ? `${m[1]}.${m[2] ?? m[3]}` : m[1];
    return MCP_LABEL[key] ?? key;
  });
  return [...new Set(calls)].join(", ") || code.split("\n")[0];
}

function describe(e: AuditEntry): { icon: string; text: string; tone?: "warn" | "bad" | "good" } {
  const d = e.detail ?? {};
  const input = d.input ?? {};
  switch (true) {
    case e.kind === "prompt":
      return { icon: "💬", text: `“${d.text}”${d.files?.length ? ` + ${d.files.length} file(s)` : ""}` };
    case e.kind === "session.created":
      return { icon: "✨", text: `New conversation${d.model ? ` · ${d.model.id}` : ""}` };
    case e.kind === "interrupt":
      return { icon: "■", text: "Stopped the agent", tone: "warn" };
    case e.kind === "session.tool.called":
      return {
        icon: "⚙️",
        text:
          typeof input.command === "string"
            ? `$ ${input.command}`
            : typeof input.code === "string"
              ? codeCalls(input.code)
              : (input.path ?? input.filePath ?? input.url ?? input.pattern ?? JSON.stringify(input).slice(0, 140)),
      };
    case e.kind === "session.tool.success":
      return { icon: "✓", text: (d.output ?? "").slice(0, 140) || "completed", tone: "good" };
    case e.kind === "session.tool.failed":
      return { icon: "✗", text: d.error?.message ?? "failed", tone: "bad" };
    case e.kind === "permission.asked":
      return { icon: "✋", text: `Asked: ${d.action} ${(d.resources ?? []).filter((r: string) => r !== "*").join(", ")}`, tone: "warn" };
    case e.kind === "permission.decision":
      return d.decision === "reject"
        ? { icon: "⛔", text: "You denied", tone: "bad" }
        : { icon: "✅", text: d.decision === "always" ? "You allowed (always)" : "You allowed", tone: "good" };
    case e.kind === "permission.auto-approved":
      return { icon: "🤖", text: `Auto-approved: ${d.action} ${(d.resources ?? []).join(", ")}`, tone: "warn" };
    case e.kind === "permission.replied":
      return { icon: "↩", text: `Permission ${d.reply}` };
    case e.kind === "auto-approve":
      return { icon: "🤖", text: `Auto-approve ${d.enabled ? "on" : "off"}`, tone: d.enabled ? "warn" : undefined };
    case e.kind === "file.shared":
      return { icon: "📤", text: `Sent to phone: ${d.name}`, tone: "good" };
    case e.kind === "file.share-refused":
      return { icon: "🚫", text: `Refused to share ${d.path}`, tone: "bad" };
    case e.kind === "file.downloaded":
      return { icon: "⬇️", text: `Downloaded ${d.name}` };
    case e.kind === "file.uploaded":
      return { icon: "📥", text: `Sent to Mac: ${(d.files ?? []).map((f: any) => f.name).join(", ")}` };
    case e.kind.startsWith("quick."):
      return { icon: "⚡", text: `${e.kind.slice(6)}${d.arg ? ` ${d.arg}` : ""}${d.error ? ` (failed: ${d.error})` : ""}`, tone: d.error ? "bad" : undefined };
    case e.kind.startsWith("memory."):
      return { icon: "🧠", text: e.kind === "memory.remember" ? `Remembered: ${d.fact}` : `Forgot “${d.match}” (${d.removed})` };
    case e.kind.startsWith("context."):
      return { icon: "📝", text: `Edited ${e.kind.slice(8)}` };
    case e.kind.startsWith("push."):
      return { icon: "🔔", text: e.kind === "push.agent" ? `Notified: ${d.title}` : "Notifications enabled" };
    case e.kind === "session.execution.failed":
      return { icon: "✗", text: `Run failed: ${d.error?.message ?? ""}`, tone: "bad" };
    default:
      return { icon: "•", text: e.kind };
  }
}

const who = (actor: string | null) => (actor === "agent" ? "agent" : actor === "lazylink" ? "auto" : "you");

function Row({ e, sessionTitle, onOpenSession }: { e: AuditEntry; sessionTitle?: string; onOpenSession: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const { icon, text, tone } = describe(e);
  return (
    <div className={`act-row ${tone ?? ""} ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
      <span className="act-time mono">{new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      <span className="act-icon">{icon}</span>
      <div className="act-main">
        <div className="act-text">{text}</div>
        <div className="act-meta">
          <span className={`act-who ${who(e.actor)}`}>{who(e.actor)}</span>
          {sessionTitle && <span className="act-session">{sessionTitle}</span>}
        </div>
        {open && (
          <div className="act-detail" onClick={(ev) => ev.stopPropagation()}>
            <pre className="mono">{JSON.stringify(e.detail, null, 2)}</pre>
            {e.sessionId && (
              <button className="link-btn" onClick={() => onOpenSession(e.sessionId!)}>
                Open conversation →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Activity({
  sessions,
  currentId,
  onOpenSession,
  onBack,
  subscribeAudit,
}: {
  sessions: SessionInfo[];
  currentId?: string;
  onOpenSession: (id: string) => void;
  onBack: () => void;
  subscribeAudit: (fn: (e: AuditEntry) => void) => () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [onlyThis, setOnlyThis] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds;
  const sessionId = onlyThis ? currentId : undefined;
  const titles = new Map(sessions.map((s) => [s.id, s.title ?? "Untitled"]));

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      try {
        const page = await api.audit({ before, kinds, sessionId, limit: 60 });
        setEntries((cur) => (before ? [...cur, ...page] : page));
        setDone(page.length < 60);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, sessionId],
  );

  useEffect(() => void load(), [load]);

  useEffect(
    () =>
      subscribeAudit((e) => {
        if (!matches(e, kinds) || (sessionId && e.sessionId !== sessionId)) return;
        setEntries((cur) => (cur.some((x) => x.id === e.id) ? cur : [e, ...cur]));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscribeAudit, filter, sessionId],
  );

  const visible = entries.filter((e) => matches(e, kinds));
  const groups: [string, AuditEntry[]][] = [];
  for (const e of visible) {
    const day = new Date(e.ts).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
    const last = groups[groups.length - 1];
    if (last?.[0] === day) last[1].push(e);
    else groups.push([day, [e]]);
  }

  return (
    <div className="activity">
      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? "chip-on" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        {currentId && (
          <button className={`chip ${onlyThis ? "chip-on" : ""}`} onClick={() => setOnlyThis(!onlyThis)}>
            This conversation
          </button>
        )}
      </div>
      <div className="thread">
        {groups.length === 0 && !loading && <div className="empty muted">Nothing here yet.</div>}
        {groups.map(([day, rows]) => (
          <section key={day}>
            <h4 className="act-day">{day}</h4>
            {rows.map((e) => (
              <Row key={e.id} e={e} sessionTitle={e.sessionId ? titles.get(e.sessionId) : undefined} onOpenSession={onOpenSession} />
            ))}
          </section>
        ))}
        {!done && entries.length > 0 && (
          <button className="btn small load-more" disabled={loading} onClick={() => void load(entries[entries.length - 1].id)}>
            {loading ? "Loading…" : "Load older"}
          </button>
        )}
        <button className="link-btn back-link" onClick={onBack}>
          ← Back to chat
        </button>
      </div>
    </div>
  );
}
