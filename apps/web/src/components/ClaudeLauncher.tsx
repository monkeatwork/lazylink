import { useEffect, useState } from "react";
import { api, type ClaudeProject, type ClaudeSession } from "../api.ts";

const DIR_KEY = "lazylink:claude-dir";

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const short = (dir: string, home?: string) => (home && dir.startsWith(home) ? "~" + dir.slice(home.length) : dir);

/** Start, continue or resume Claude Code on the Mac with Remote Control on. No model involved. */
export function ClaudeLauncher({
  home,
  onDone,
  onError,
}: {
  home?: string;
  onDone: (text: string) => void;
  onError: (msg: string) => void;
}) {
  const [dir, setDir] = useState(() => {
    try {
      return localStorage.getItem(DIR_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [projects, setProjects] = useState<ClaudeProject[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [busy, setBusy] = useState<string>();

  // The folder as the server sees it: "~/x" or "x" (relative to home) become absolute.
  const absDir = !dir.trim()
    ? ""
    : dir.startsWith("/")
      ? dir.trim()
      : `${home ?? ""}/${dir.trim().replace(/^~\/?/, "")}`.replace(/\/$/, "");
  const known = projects.some((p) => p.dir === absDir);

  useEffect(() => {
    api.claude().then(
      (r) => setProjects(r.projects),
      (err) => onError((err as Error).message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DIR_KEY, dir);
    } catch {
      /* private mode */
    }
    if (!absDir) return setSessions([]);
    const t = setTimeout(
      () =>
        api.claude(absDir).then(
          (r) => setSessions(r.sessions),
          () => setSessions([]),
        ),
      250,
    );
    return () => clearTimeout(t);
  }, [absDir, dir]);

  const start = async (mode: "new" | "continue" | "resume", sessionId?: string) => {
    if (!absDir) return onError("Pick a folder first");
    setBusy(sessionId ?? mode);
    try {
      const r = await api.startClaude({ dir: absDir, mode, sessionId, create: mode === "new" });
      onDone(r.text);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="claude-launcher">
      <p className="muted tiny sheet-sub">
        Opens Claude Code in a WezTerm tab on your Mac with Remote Control on. Then pick it in the Claude app.
      </p>
      <input
        className="claude-dir mono"
        value={dir}
        placeholder="~/projects/my-app"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setDir(e.target.value)}
      />
      {projects.length > 0 && (
        <div className="claude-projects">
          {projects.map((p) => (
            <button key={p.dir} className={`chip ${p.dir === absDir ? "chip-on" : ""}`} onClick={() => setDir(short(p.dir, home))}>
              {p.dir.split("/").pop()}
            </button>
          ))}
        </div>
      )}
      <div className="claude-actions">
        <button className="btn primary" disabled={!absDir || !!busy} onClick={() => void start("new")}>
          {busy === "new" ? "Starting…" : known || !absDir ? "New session" : "Create folder + start"}
        </button>
        <button className="btn" disabled={!sessions.length || !!busy} onClick={() => void start("continue")}>
          {busy === "continue" ? "Starting…" : "Continue latest"}
        </button>
      </div>
      {sessions.length > 0 && (
        <>
          <h4 className="claude-h">Resume</h4>
          <div className="claude-sessions">
            {sessions.map((s) => (
              <button key={s.id} className="claude-session" disabled={s.running || !!busy} onClick={() => void start("resume", s.id)}>
                <span className="claude-title">{busy === s.id ? "Starting…" : s.title}</span>
                <span className="muted tiny">{s.running ? "open on the Mac" : ago(s.updated)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
