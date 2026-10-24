import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, subscribe, type ModelInfo, type ModelRef, type PermissionRequest, type SessionInfo, type Status } from "./api.ts";
import { Composer } from "./components/Composer.tsx";
import { Login } from "./components/Login.tsx";
import { Message } from "./components/Messages.tsx";
import { PermissionCard } from "./components/PermissionCard.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { applyEvent, emptyTranscript, fromHistory, shouldReconcile, type Transcript } from "./transcript.ts";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

const modelKey = (m?: ModelRef | null) => (m ? `${m.providerID}/${m.id}` : "");
const parseModelKey = (k: string): ModelRef | undefined => {
  const i = k.indexOf("/");
  return i > 0 ? { providerID: k.slice(0, i), id: k.slice(i + 1) } : undefined;
};

const SUGGESTIONS = [
  "What are the 10 biggest files in my Downloads folder?",
  "Take a screenshot and tell me what's on my screen",
  "Open github.com in the agent browser and show me my notifications",
  "Which apps are running right now?",
];

export function App() {
  const [auth, setAuth] = useState<"checking" | "locked" | "ok">("checking");
  const [status, setStatus] = useState<Status>();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | undefined>(() => store.get("lazylink:session") ?? undefined);
  const [transcript, setTranscript] = useState<Transcript>(emptyTranscript);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [connected, setConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pickedModel, setPickedModel] = useState(() => store.get("lazylink:model") ?? "");
  const [toast, setToast] = useState<string>();

  const currentRef = useRef(currentId);
  currentRef.current = currentId;
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(undefined), 4000);
  };
  const guard = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
    async (...a: A) => {
      try {
        await fn(...a);
      } catch (err) {
        flash((err as Error).message);
        throw err;
      }
    };

  // ---------- loaders ----------

  const loadSessions = useCallback(() => api.sessions().then(setSessions).catch(() => {}), []);
  const loadStatus = useCallback(() => api.status().then(setStatus).catch(() => {}), []);
  const loadPermissions = useCallback(() => api.permissions().then(setPermissions).catch(() => {}), []);
  const loadMessages = useCallback(async (id: string) => {
    try {
      const raw = await api.messages(id);
      if (currentRef.current !== id) return;
      setTranscript((t) => ({ ...t, messages: fromHistory(raw) }));
    } catch {
      /* session may have been deleted */
    }
  }, []);

  const refreshAll = useCallback(() => {
    void loadStatus();
    void loadSessions();
    void loadPermissions();
    api.models().then(setModels).catch(() => {});
    if (currentRef.current) void loadMessages(currentRef.current);
  }, [loadStatus, loadSessions, loadPermissions, loadMessages]);

  // ---------- auth ----------

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setAuth(s.authenticated ? "ok" : "locked"))
      .catch(() => setAuth("locked"));
    const onUnauthorized = () => setAuth("locked");
    window.addEventListener("lazylink:unauthorized", onUnauthorized);
    return () => window.removeEventListener("lazylink:unauthorized", onUnauthorized);
  }, []);

  // ---------- live events ----------

  useEffect(() => {
    if (auth !== "ok") return;
    refreshAll();
    const statusTimer = setInterval(loadStatus, 30_000);
    const unsubscribe = subscribe(
      ({ type, data }) => {
        if (type === "permission.asked") setPermissions((p) => (p.some((x) => x.id === data.id) ? p : [...p, data]));
        else if (type === "permission.replied") setPermissions((p) => p.filter((x) => x.id !== data.requestID));
        else if (type === "session.renamed" || type === "session.created") void loadSessions();
        else if (type === "lazylink.auto-approve")
          setSessions((ss) => ss.map((s) => (s.id === data.sessionID ? { ...s, autoApprove: data.enabled } : s)));
        else if (type === "lazylink.status") void loadStatus();

        if (data?.sessionID && data.sessionID === currentRef.current) {
          setTranscript((t) => applyEvent(t, type, data));
          if (shouldReconcile(type)) {
            void loadMessages(data.sessionID);
            void loadSessions();
          }
        }
      },
      () => {
        setConnected(true);
        refreshAll();
      },
      () => setConnected(false),
    );
    return () => {
      clearInterval(statusTimer);
      unsubscribe();
    };
  }, [auth, refreshAll, loadStatus, loadSessions, loadMessages]);

  // ---------- current session ----------

  useEffect(() => {
    store.set("lazylink:session", currentId ?? null);
    setTranscript(emptyTranscript);
    stickToBottom.current = true;
    if (currentId && auth === "ok") void loadMessages(currentId);
  }, [currentId, auth, loadMessages]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [transcript, permissions]);

  const current = sessions.find((s) => s.id === currentId);
  const sessionPermissions = permissions.filter((p) => p.sessionID === currentId);
  const otherPermissions = permissions.filter((p) => p.sessionID !== currentId);
  const activeModel = current?.model ? modelKey(current.model) : pickedModel || modelKey(status?.defaultModel);

  // ---------- actions ----------

  const newSession = guard(async () => {
    const s = await api.createSession(parseModelKey(activeModel));
    await loadSessions();
    setCurrentId(s.id);
    setSidebarOpen(false);
    return s.id;
  });

  const send = async (text: string) => {
    let id = currentId;
    if (!id) {
      const s = await api.createSession(parseModelKey(activeModel)).catch((e) => (flash(e.message), Promise.reject(e)));
      id = s.id;
      currentRef.current = id;
      setCurrentId(id);
      void loadSessions();
    }
    stickToBottom.current = true;
    setTranscript((t) => ({
      ...t,
      busy: true,
      notice: undefined,
      messages: [...t.messages, { id: `local:${Date.now()}`, role: "user", text, time: Date.now() }],
    }));
    await guard(api.prompt)(id, text);
  };

  const changeModel = guard(async (key: string) => {
    setPickedModel(key);
    store.set("lazylink:model", key);
    const ref = parseModelKey(key);
    if (currentId && ref) {
      await api.switchModel(currentId, ref);
      await loadSessions();
    }
  });

  const toggleAutoApprove = guard(async () => {
    if (!current) return;
    const enable = !current.autoApprove;
    if (enable && !confirm("Auto-approve every action in this conversation? Hard-denied actions stay blocked.")) return;
    await api.setAutoApprove(current.id, enable);
    setSessions((ss) => ss.map((s) => (s.id === current.id ? { ...s, autoApprove: enable } : s)));
  });

  if (auth === "checking") return <div className="splash">⌘</div>;
  if (auth === "locked") return <Login onDone={() => setAuth("ok")} />;

  const free = models.filter((m) => m.free);
  const paid = models.filter((m) => !m.free);

  return (
    <div className="app">
      <Sidebar
        open={sidebarOpen}
        sessions={sessions}
        currentId={currentId}
        status={status}
        connected={connected}
        onSelect={(id) => {
          setCurrentId(id);
          setSidebarOpen(false);
        }}
        onNew={() => void newSession().catch(() => {})}
        onDelete={(id) =>
          void guard(api.deleteSession)(id)
            .then(() => {
              if (id === currentId) setCurrentId(undefined);
              return loadSessions();
            })
            .catch(() => {})
        }
        onStartChrome={() =>
          void api.startChrome().then((r) => {
            if (r.error) flash(r.error);
            void loadStatus();
          })
        }
        onLogout={() => void api.logout().finally(() => setAuth("locked"))}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu" onClick={() => setSidebarOpen(true)} aria-label="Conversations">
            ☰
          </button>
          <div className="title">{current?.title ?? (currentId ? "Conversation" : "New conversation")}</div>
          <select className="model-select" value={activeModel} onChange={(e) => void changeModel(e.target.value).catch(() => {})}>
            {!models.some((m) => modelKey(m) === activeModel) && <option value={activeModel}>{activeModel || "Pick a model"}</option>}
            {free.length > 0 && (
              <optgroup label="Free / local">
                {free.map((m) => (
                  <option key={modelKey(m)} value={modelKey(m)}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            )}
            {paid.length > 0 && (
              <optgroup label="Paid (needs a provider key)">
                {paid.map((m) => (
                  <option key={modelKey(m)} value={modelKey(m)}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {current && (
            <button
              className={`chip ${current.autoApprove ? "chip-warn" : ""}`}
              onClick={() => void toggleAutoApprove().catch(() => {})}
              title="Auto-approve actions in this conversation"
            >
              {current.autoApprove ? "auto ✓" : "ask"}
            </button>
          )}
        </header>

        <div
          className="scroller"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="thread">
            {transcript.messages.length === 0 && !transcript.busy && (
              <div className="empty">
                <div className="empty-mark">⌘</div>
                <p>Your Mac is listening.</p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="suggestion" onClick={() => void send(s).catch(() => {})}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {transcript.messages.map((m) => (
              <Message key={m.id} msg={m} />
            ))}
            {sessionPermissions.map((p) => (
              <PermissionCard
                key={p.id}
                req={p}
                onReply={guard((d: "once" | "always" | "reject") => api.replyPermission(p.sessionID, p.id, d))}
              />
            ))}
            {transcript.busy && sessionPermissions.length === 0 && <div className="working">working…</div>}
            {transcript.notice && <div className="notice">{transcript.notice}</div>}
          </div>
        </div>

        {otherPermissions.length > 0 && (
          <button className="other-perms" onClick={() => setCurrentId(otherPermissions[0].sessionID)}>
            {otherPermissions.length} approval{otherPermissions.length > 1 ? "s" : ""} waiting in another conversation →
          </button>
        )}

        <Composer
          busy={transcript.busy}
          disabled={!connected}
          onSend={send}
          onStop={() => currentId && void guard(api.interrupt)(currentId).catch(() => {})}
        />
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
