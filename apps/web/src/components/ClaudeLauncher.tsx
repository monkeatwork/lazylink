import { useEffect, useState } from "react";
import { api, type ClaudePaneState, type ClaudeProject, type ClaudeSession } from "../api.ts";

const DIR_KEY = "lazylink:claude-dir";

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const short = (dir: string, home?: string) => (home && dir.startsWith(home) ? "~" + dir.slice(home.length) : dir);
const openLabel = (s: ClaudeSession) => (s.remote ? "open · Remote Control on" : "open · no Remote Control");

/** A launched tab: followed until Remote Control is up, with a button for the folder-trust prompt. */
type Launch = { pane?: string; dir: string; text: string; state: ClaudePaneState };

function LaunchCard({ launch, home, onTrust, trusting }: { launch: Launch; home?: string; onTrust: () => void; trusting: boolean }) {
  const where = short(launch.dir, home);
  switch (launch.state) {
    case "trust":
      return (
        <div className="claude-status warn">
          <div>
            Claude Code is asking whether to trust <span className="mono">{where}</span>. It hasn't opened this folder before.
          </div>
          <button className="btn primary" disabled={trusting} onClick={onTrust}>
            {trusting ? "Trusting…" : "Trust this folder"}
          </button>
        </div>
      );
    case "ready":
      return (
        <div className="claude-status good">
          <div>
            Remote Control is on in <span className="mono">{where}</span>. Open it from the Claude app (Code tab).
          </div>
        </div>
      );
    case "gone":
      return <div className="claude-status">{launch.pane ? "That tab was closed." : launch.text}</div>;
    default:
      return (
        <div className="claude-status">
          <div>
            Starting Claude Code in <span className="mono">{where}</span>…
          </div>
        </div>
      );
  }
}

/** Start, continue or resume Claude Code on the Mac with Remote Control on. No model involved. */
export function ClaudeLauncher({ home, onError }: { home?: string; onError: (msg: string) => void }) {
  const [dir, setDir] = useState(() => {
    try {
      return localStorage.getItem(DIR_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [projects, setProjects] = useState<ClaudeProject[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();

  // The folder as the server sees it: "~/x" or "x" (relative to home) become absolute.
  const absDir = !dir.trim()
    ? ""
    : dir.startsWith("/")
      ? dir.trim()
      : `${home ?? ""}/${dir.trim().replace(/^~\/?/, "")}`.replace(/\/$/, "");
  const known = projects.some((p) => p.dir === absDir);
  const latest = sessions[0];

  const refresh = () =>
    absDir
      ? api.claude({ dir: absDir }).then(
          (r) => setSessions(r.sessions),
          () => setSessions([]),
        )
      : setSessions([]);

  useEffect(() => {
    // Tabs already waiting at the trust prompt (e.g. opened by the agent) get a Trust button too.
    api.claude({ pending: true }).then(
      (r) => {
        setProjects(r.projects);
        setLaunches((cur) => [...(r.pending ?? []).map((p) => ({ ...p, text: "", state: "trust" as const })), ...cur]);
      },
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
    setNotice(undefined);
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absDir]);

  // Follow launched tabs until they're ready or gone.
  const following = launches.some((l) => l.pane && (l.state === "starting" || l.state === "trust"));
  useEffect(() => {
    if (!following) return;
    const t = setInterval(async () => {
      const next = await Promise.all(
        launches.map(async (l) =>
          l.pane && (l.state === "starting" || l.state === "trust")
            ? { ...l, state: (await api.claudePane(l.pane).catch(() => ({ state: l.state }))).state }
            : l,
        ),
      );
      setLaunches(next);
      if (next.some((l, i) => l.state === "ready" && launches[i].state !== "ready")) void refresh();
    }, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, launches]);

  const start = async (mode: "new" | "continue" | "resume", sessionId?: string) => {
    if (!absDir) return onError("Pick a folder first");
    setBusy(sessionId ?? mode);
    setNotice(undefined);
    try {
      const r = await api.startClaude({ dir: absDir, mode, sessionId, create: mode === "new" });
      setLaunches((cur) => [{ pane: r.pane, dir: r.dir, text: r.text, state: r.pane ? "starting" : "gone" }, ...cur.slice(0, 3)]);
    } catch (err) {
      setNotice((err as Error).message); // e.g. "… is already open on the Mac with Remote Control on"
      void refresh();
    } finally {
      setBusy(undefined);
    }
  };

  const trust = async (pane: string) => {
    setBusy(`trust-${pane}`);
    try {
      const { state } = await api.trustClaudeFolder(pane);
      setLaunches((cur) => cur.map((l) => (l.pane === pane ? { ...l, state } : l)));
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
      {launches.map((l, i) => (
        <LaunchCard
          key={(l.pane ?? "") + i}
          launch={l}
          home={home}
          trusting={busy === `trust-${l.pane}`}
          onTrust={() => void trust(l.pane!)}
        />
      ))}
      {notice && <div className="claude-status warn">{notice}</div>}
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
        <button className="btn" disabled={!latest || !!busy} onClick={() => void start("continue")}>
          {busy === "continue" ? "Starting…" : latest?.running ? "Latest is open" : "Continue latest"}
        </button>
      </div>
      {sessions.length > 0 && (
        <>
          <h4 className="claude-h">Resume</h4>
          <div className="claude-sessions">
            {sessions.map((s) => (
              <button
                key={s.id}
                className={`claude-session ${s.running ? "open" : ""}`}
                disabled={!!busy}
                onClick={() => void start("resume", s.id)}
              >
                <span className="claude-title">{busy === s.id ? "Starting…" : s.title}</span>
                <span className={`tiny ${s.running ? (s.remote ? "rc-on" : "rc-off") : "muted"}`}>
                  {s.running ? openLabel(s) : ago(s.updated)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
