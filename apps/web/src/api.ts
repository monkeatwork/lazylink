export type ModelRef = { providerID: string; id: string };
export type ModelInfo = ModelRef & { name: string; free: boolean; local: boolean };
export type SessionInfo = {
  id: string;
  title: string | null;
  model: ModelRef | null;
  outcome: string | null;
  cost: number;
  created: number;
  updated: number;
  autoApprove: boolean;
};
export type PermissionRequest = {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  message?: string;
};
export type Status = {
  opencode: boolean;
  events: boolean;
  chrome: { running: boolean; installed: boolean; browser?: string };
  workdir: string;
  defaultModel?: ModelRef;
  user: string | null;
  keepAwake: boolean;
  pushSubscriptions: number;
};
export type AuditEntry = { id: number; ts: number; kind: string; sessionId: string | null; actor: string | null; detail: any };
export type Uploaded = { path: string; name: string; size: number };
export type QuickResult = { text?: string; url?: string; keepAwake?: boolean; error?: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("lazylink:unauthorized"));
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  }
  return data as T;
}

export const api = {
  authStatus: () => req<{ authenticated: boolean; user: string | null }>("/auth/status"),
  login: (passcode: string) => req<{ ok: true }>("/auth/login", { body: { passcode } }),
  logout: () => req("/auth/logout", { method: "POST" }),

  status: () => req<Status>("/api/status"),
  models: () => req<ModelInfo[]>("/api/models"),
  sessions: () => req<SessionInfo[]>("/api/sessions"),
  createSession: (model?: ModelRef) => req<{ id: string }>("/api/sessions", { body: { model } }),
  deleteSession: (id: string) => req(`/api/sessions/${id}`, { method: "DELETE" }),
  messages: (id: string) => req<any[]>(`/api/sessions/${id}/messages`),
  prompt: (id: string, text: string, files?: string[]) => req(`/api/sessions/${id}/prompt`, { body: { text, files } }),
  interrupt: (id: string) => req(`/api/sessions/${id}/interrupt`, { method: "POST" }),
  switchModel: (id: string, model: ModelRef) => req(`/api/sessions/${id}/model`, { body: model }),
  setAutoApprove: (id: string, enabled: boolean) => req(`/api/sessions/${id}/auto-approve`, { body: { enabled } }),
  permissions: () => req<PermissionRequest[]>("/api/permissions"),
  replyPermission: (sessionID: string, id: string, decision: "once" | "always" | "reject") =>
    req(`/api/sessions/${sessionID}/permissions/${id}`, { body: { decision } }),
  startChrome: () => req<{ running: boolean; error?: string }>("/api/chrome/start", { method: "POST" }),

  audit: (q: { before?: number; sessionId?: string; kinds?: string[]; limit?: number }) => {
    const p = new URLSearchParams();
    if (q.before) p.set("before", String(q.before));
    if (q.sessionId) p.set("sessionId", q.sessionId);
    if (q.kinds?.length) p.set("kinds", q.kinds.join(","));
    p.set("limit", String(q.limit ?? 60));
    return req<AuditEntry[]>(`/api/audit?${p}`);
  },
  getContext: (which: "profile" | "memory") => req<{ text: string }>(`/api/context/${which}`),
  putContext: (which: "profile" | "memory", text: string) => req(`/api/context/${which}`, { method: "PUT", body: { text } }),
  quick: (action: string, arg?: string) => req<QuickResult>(`/api/quick/${action}`, { body: { arg } }),
  pushKey: () => req<{ key: string; subscriptions: number }>("/api/push/key"),
  pushSubscribe: (sub: PushSubscriptionJSON) => req("/api/push/subscribe", { body: sub }),
  pushUnsubscribe: (endpoint: string) => req("/api/push/unsubscribe", { body: { endpoint } }),
  pushTest: () => req<{ sent: number }>("/api/push/test", { method: "POST" }),
  presence: () => req("/api/presence", { method: "POST" }).catch(() => {}),
};

/** Uploads files to the Mac's inbox, reporting progress (0..1). XHR because fetch has no upload progress. */
export function upload(files: File[], onProgress: (p: number) => void): Promise<Uploaded[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 401) window.dispatchEvent(new Event("lazylink:unauthorized"));
      xhr.status < 300 ? resolve(data) : reject(new ApiError(xhr.status, data.error ?? "Upload failed"));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed: can't reach your Mac"));
    xhr.send(form);
  });
}

/** Server-sent events from lazylink (relayed opencode events + lazylink status). Reconnects automatically. */
export function subscribe(onEvent: (e: { type: string; data: any }) => void, onOpen: () => void, onError: () => void) {
  const es = new EventSource("/api/events");
  es.onopen = onOpen;
  es.onerror = onError;
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}
