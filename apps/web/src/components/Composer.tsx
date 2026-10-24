import { useEffect, useRef, useState } from "react";

const DRAFT_KEY = "lazylink:draft";

export function Composer({
  busy,
  disabled,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
}) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const ref = useRef<HTMLTextAreaElement>(null);

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

  const send = async () => {
    const value = text.trim();
    if (!value || disabled) return;
    setText("");
    try {
      await onSend(value);
    } catch {
      setText(value);
    }
  };

  return (
    <div className="composer">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={disabled ? "Connecting to your Mac…" : "Ask your Mac to do something…"}
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
      <button className="btn primary" onClick={send} disabled={disabled || !text.trim()} title="Send">
        ↑
      </button>
    </div>
  );
}
