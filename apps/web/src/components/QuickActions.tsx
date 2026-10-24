import { useState } from "react";
import { api, type QuickResult } from "../api.ts";
import { Sheet } from "./Sheet.tsx";

const TILES: { action: string; arg?: string; icon: string; label: string }[] = [
  { action: "screenshot", icon: "📸", label: "Screenshot" },
  { action: "battery", icon: "🔋", label: "Status" },
  { action: "lock", icon: "🔒", label: "Lock" },
  { action: "playpause", icon: "⏯", label: "Play/Pause" },
  { action: "volume", arg: "down", icon: "🔉", label: "Vol −" },
  { action: "volume", arg: "up", icon: "🔊", label: "Vol +" },
  { action: "volume", arg: "mute", icon: "🔇", label: "Mute" },
];

export function QuickActions({
  open,
  keepAwake,
  onClose,
  onKeepAwake,
  onError,
}: {
  open: boolean;
  keepAwake: boolean;
  onClose: () => void;
  onKeepAwake: (on: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [running, setRunning] = useState<string>();
  const [result, setResult] = useState<QuickResult>();

  const run = async (action: string, arg?: string) => {
    const key = action + (arg ?? "");
    setRunning(key);
    setResult(undefined);
    try {
      const r = await api.quick(action, arg);
      if (r.keepAwake !== undefined) onKeepAwake(r.keepAwake);
      setResult(r);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRunning(undefined);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Quick actions">
      <p className="muted tiny sheet-sub">Runs instantly on your Mac, with no AI involved.</p>
      <div className="tiles">
        {TILES.map((t) => (
          <button
            key={t.action + (t.arg ?? "")}
            className={`tile ${running === t.action + (t.arg ?? "") ? "running" : ""}`}
            disabled={!!running}
            onClick={() => void run(t.action, t.arg)}
          >
            <span className="tile-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
        <button
          className={`tile ${keepAwake ? "on" : ""} ${running === "keep-awake" ? "running" : ""}`}
          disabled={!!running}
          onClick={() => void run("keep-awake", keepAwake ? "off" : "on")}
        >
          <span className="tile-icon">☕</span>
          <span>{keepAwake ? "Awake: on" : "Keep awake"}</span>
        </button>
      </div>
      {result?.url && (
        <a href={result.url} target="_blank" rel="noreferrer" className="quick-shot">
          <img src={result.url} alt="Screenshot" />
        </a>
      )}
      {result?.text && <pre className="mono quick-text">{result.text}</pre>}
    </Sheet>
  );
}
