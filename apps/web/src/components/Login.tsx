import { useState } from "react";
import { api, ApiError } from "../api.ts";

export function Login({ onDone }: { onDone: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.login(passcode);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach your Mac");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form onSubmit={submit} className="login-card">
        <div className="brand">
          <span className="brand-mark">⌘</span> lazylink
        </div>
        <p className="muted">Unlock your Mac.</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
        />
        {error && <div className="error-text">{error}</div>}
        <button className="btn primary" disabled={busy || !passcode}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
