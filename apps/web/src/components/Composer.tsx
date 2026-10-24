import { useEffect, useRef, useState } from "react";
import { upload, type Uploaded } from "../api.ts";

const DRAFT_KEY = "lazylink:draft";

const human = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function Composer({
  busy,
  disabled,
  incoming,
  onIncomingConsumed,
  onSend,
  onStop,
  onQuick,
  onError,
}: {
  busy: boolean;
  disabled: boolean;
  /** Files handed to the app from the Android share sheet. */
  incoming: File[];
  onIncomingConsumed: () => void;
  onSend: (text: string, files: string[]) => Promise<void>;
  onStop: () => void;
  onQuick: () => void;
  onError: (msg: string) => void;
}) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [attached, setAttached] = useState<Uploaded[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* private mode */
    }
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [text]);

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setProgress(0);
    try {
      const saved = await upload(files, setProgress);
      setAttached((a) => [...a, ...saved]);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setProgress(null);
    }
  };

  useEffect(() => {
    if (!incoming.length) return;
    void uploadFiles(incoming);
    onIncomingConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  const send = async () => {
    const value = text.trim() || (attached.length ? "Here are some files." : "");
    if (!value || disabled || progress !== null) return;
    const files = attached;
    setText("");
    setAttached([]);
    try {
      await onSend(value, files.map((f) => f.path));
    } catch {
      setText(value);
      setAttached(files);
    }
  };

  return (
    <div className="composer-wrap">
      {(attached.length > 0 || progress !== null) && (
        <div className="attachments">
          {attached.map((f) => (
            <span key={f.path} className="attachment">
              📎 {f.name} <span className="muted">{human(f.size)}</span>
              <button className="icon-btn" onClick={() => setAttached((a) => a.filter((x) => x.path !== f.path))} aria-label="Remove">
                ×
              </button>
            </span>
          ))}
          {progress !== null && (
            <span className="attachment uploading">
              Sending to Mac… {Math.round(progress * 100)}%
              <span className="progress" style={{ width: `${progress * 100}%` }} />
            </span>
          )}
        </div>
      )}
      <div className="composer">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void uploadFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <button className="btn ghost" onClick={() => picker.current?.click()} title="Send files to your Mac" disabled={disabled}>
          📎
        </button>
        <button className="btn ghost" onClick={onQuick} title="Quick actions" disabled={disabled}>
          ⚡
        </button>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={disabled ? "Connecting to your Mac…" : "Message your Mac…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy && (
          <button className="btn danger" onClick={onStop} title="Stop">
            ■
          </button>
        )}
        <button
          className="btn primary"
          onClick={send}
          disabled={disabled || progress !== null || (!text.trim() && !attached.length)}
          title="Send"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
