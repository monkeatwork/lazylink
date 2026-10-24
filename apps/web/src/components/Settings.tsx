import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../push.ts";
import { Sheet } from "./Sheet.tsx";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function ContextEditor({ which, title, hint }: { which: "profile" | "memory"; title: string; hint: string }) {
  const [text, setText] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    api.getContext(which).then((r) => (setText(r.text), setSaved(r.text))).catch(() => setState("error"));
  }, [which]);

  const save = async () => {
    if (text === undefined) return;
    setState("saving");
    try {
      await api.putContext(which, text);
      setSaved(text);
      setState("saved");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="settings-section">
      <h3>{title}</h3>
      <p className="muted tiny">{hint}</p>
      <textarea className="context-editor mono" value={text ?? "Loading…"} disabled={text === undefined} onChange={(e) => (setText(e.target.value), setState("idle"))} />
      <div className="row-end">
        <span className="muted tiny">{state === "saved" ? "Saved ✓" : state === "error" ? "Couldn't save" : ""}</span>
        <button className="btn small primary" disabled={text === saved || state === "saving"} onClick={() => void save()}>
          Save
        </button>
      </div>
    </section>
  );
}

export function Settings({
  open,
  onClose,
  installPrompt,
  onInstalled,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  installPrompt: InstallPrompt | null;
  onInstalled: () => void;
  onError: (msg: string) => void;
}) {
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [testSent, setTestSent] = useState<string>();
  const standalone = window.matchMedia("(display-mode: standalone)").matches;

  useEffect(() => {
    if (open) void currentSubscription().then((s) => setPushOn(!!s));
  }, [open]);

  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
      } else {
        await enablePush();
        setPushOn(true);
      }
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <section className="settings-section">
        <h3>App</h3>
        {standalone ? (
          <p className="muted">Installed as an app ✓</p>
        ) : installPrompt ? (
          <button
            className="btn primary"
            onClick={async () => {
              await installPrompt.prompt();
              if ((await installPrompt.userChoice).outcome === "accepted") onInstalled();
            }}
          >
            Install lazylink as an app
          </button>
        ) : (
          <p className="muted tiny">
            To install: in Chrome, tap ⋮ → <b>Install app</b>. Don't use "Add to Home screen", which only makes a shortcut. Once
            installed, lazylink gets its own icon, opens without the address bar, and appears in the Android share sheet.
          </p>
        )}
      </section>

      <section className="settings-section">
        <h3>Notifications</h3>
        <p className="muted tiny">Get a ping when your Mac needs an approval or finishes a task while the app is closed.</p>
        {pushSupported() ? (
          <div className="row-end">
            <button className="btn small" disabled={!pushOn || pushBusy} onClick={() => void api.pushTest().then((r) => setTestSent(r.sent ? "Sent ✓" : "No devices"))}>
              Send test
            </button>
            <span className="muted tiny">{testSent}</span>
            <button className={`btn small ${pushOn ? "" : "primary"}`} disabled={pushBusy} onClick={() => void togglePush()}>
              {pushOn ? "Turn off" : "Turn on"}
            </button>
          </div>
        ) : (
          <p className="muted tiny">Install the app first; notifications need it.</p>
        )}
      </section>

      <ContextEditor
        which="profile"
        title="About me"
        hint="The agent reads this at the start of every conversation: where your things are, your accounts, how you like answers."
      />
      <ContextEditor
        which="memory"
        title="Agent memory"
        hint="Facts the agent saved when you asked it to remember something. Edit or delete freely."
      />
    </Sheet>
  );
}

export type { InstallPrompt };
