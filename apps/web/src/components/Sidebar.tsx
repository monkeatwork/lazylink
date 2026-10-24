import type { SessionInfo, Status } from "../api.ts";

type Props = {
  open: boolean;
  sessions: SessionInfo[];
  currentId?: string;
  status?: Status;
  connected: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onStartChrome: () => void;
  onLogout: () => void;
  onClose: () => void;
};

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const Dot = ({ ok }: { ok?: boolean }) => <span className={`dot ${ok ? "ok" : "bad"}`} />;

export function Sidebar(p: Props) {
  return (
    <>
      <div className={`scrim ${p.open ? "show" : ""}`} onClick={p.onClose} />
      <aside className={`sidebar ${p.open ? "open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand">
            <span className="brand-mark">⌘</span> lazylink
          </div>
          <button className="btn primary small" onClick={p.onNew}>
            + New
          </button>
        </div>

        <nav className="session-list">
          {p.sessions.length === 0 && <div className="muted pad">No conversations yet.</div>}
          {p.sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === p.currentId ? "active" : ""}`}
              onClick={() => p.onSelect(s.id)}
            >
              <div className="session-title">{s.title ?? "Untitled"}</div>
              <div className="session-meta">
                <span>{s.model ? s.model.id : ""}</span>
                <span>{ago(s.updated ?? s.created)}</span>
                <button
                  className="icon-btn"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this conversation?")) p.onDelete(s.id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="status-row">
            <Dot ok={p.connected} /> live link
          </div>
          <div className="status-row">
            <Dot ok={p.status?.opencode} /> opencode
          </div>
          <div className="status-row">
            <Dot ok={p.status?.chrome.running} /> agent Chrome
            {p.status && !p.status.chrome.running && p.status.chrome.installed && (
              <button className="link-btn" onClick={p.onStartChrome}>
                start
              </button>
            )}
          </div>
          {p.status && <div className="muted mono tiny">{p.status.workdir}</div>}
          <div className="status-row">
            <span className="muted tiny">{p.status?.user ?? ""}</span>
            <button className="link-btn" onClick={p.onLogout}>
              lock
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
