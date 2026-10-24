// Turns opencode's stored messages and live events into one simple view model.

export type Part =
  | { kind: "text"; key: string; text: string }
  | { kind: "reasoning"; key: string; text: string; done: boolean }
  | {
      kind: "tool";
      key: string;
      id: string;
      name: string;
      status: "pending" | "running" | "completed" | "error";
      input?: unknown;
      output?: string;
      error?: string;
    };

export type Msg =
  | { id: string; role: "user"; text: string; time: number }
  | { id: string; role: "assistant"; parts: Part[]; time: number; error?: string }
  | { id: string; role: "system"; text: string; time: number };

export type Transcript = { messages: Msg[]; busy: boolean; notice?: string };

export const emptyTranscript: Transcript = { messages: [], busy: false };

const toolOutput = (content: unknown): string | undefined =>
  Array.isArray(content)
    ? content
        .map((c: any) => (c?.type === "text" ? c.text : c?.type === "image" ? "[image]" : ""))
        .filter(Boolean)
        .join("\n")
    : undefined;

const errorText = (e: any): string | undefined => (e ? (e.message ?? (typeof e === "string" ? e : JSON.stringify(e))) : undefined);

/** Converts GET /messages output (oldest first) into the view model. */
export function fromHistory(raw: any[]): Msg[] {
  const out: Msg[] = [];
  for (const m of raw) {
    const time = m.time?.created ?? 0;
    switch (m.type) {
      case "user":
        out.push({ id: m.id, role: "user", text: m.text ?? m.payload?.text ?? "", time });
        break;
      case "assistant": {
        const parts: Part[] = [];
        (m.content ?? []).forEach((c: any, i: number) => {
          if (c.type === "text") parts.push({ kind: "text", key: `h${i}`, text: c.text });
          else if (c.type === "reasoning") parts.push({ kind: "reasoning", key: `h${i}`, text: c.text, done: true });
          else if (c.type === "tool") {
            const s = c.state ?? {};
            parts.push({
              kind: "tool",
              key: `tool:${c.id}`,
              id: c.id,
              name: c.name,
              status: s.status === "completed" ? "completed" : s.status === "error" || s.error ? "error" : s.status === "running" ? "running" : "pending",
              input: s.input,
              output: toolOutput(s.content),
              error: errorText(s.error),
            });
          }
        });
        out.push({ id: m.id, role: "assistant", parts, time, error: errorText(m.error) });
        break;
      }
      case "model-switched":
        out.push({ id: m.id, role: "system", text: `Model → ${m.model?.providerID}/${m.model?.id}`, time });
        break;
      case "compaction":
        out.push({ id: m.id, role: "system", text: "Conversation compacted", time });
        break;
      default:
        break;
    }
  }
  return out;
}

function updateAssistant(t: Transcript, id: string, fn: (parts: Part[]) => Part[], time = Date.now()): Transcript {
  const idx = t.messages.findIndex((m) => m.id === id);
  if (idx === -1) {
    return { ...t, messages: [...t.messages, { id, role: "assistant", parts: fn([]), time }] };
  }
  const msg = t.messages[idx];
  if (msg.role !== "assistant") return t;
  const messages = t.messages.slice();
  messages[idx] = { ...msg, parts: fn(msg.parts) };
  return { ...t, messages };
}

function upsertPart(parts: Part[], key: string, make: () => Part, patch: (p: Part) => Part): Part[] {
  const i = parts.findIndex((p) => p.key === key);
  if (i === -1) return [...parts, patch(make())];
  const next = parts.slice();
  next[i] = patch(parts[i]);
  return next;
}

/** Applies one live opencode event (already filtered to the current session). */
export function applyEvent(t: Transcript, type: string, d: any): Transcript {
  const mid: string | undefined = d?.assistantMessageID;
  switch (type) {
    case "session.inbox.enqueued": {
      const text = d.item?.payload?.text;
      if (d.item?.type !== "user" || !text) return t;
      // Replace our optimistic copy, if any.
      const messages = t.messages.filter((m) => !(m.id.startsWith("local:") && m.role === "user" && m.text === text));
      if (messages.some((m) => m.id === d.inboxID)) return t;
      return { ...t, messages: [...messages, { id: d.inboxID, role: "user", text, time: Date.now() }] };
    }
    case "session.execution.started":
      return { ...t, busy: true, notice: undefined };
    case "session.step.started":
      return mid ? { ...updateAssistant(t, mid, (p) => p), busy: true, notice: undefined } : t;
    case "session.retry.scheduled":
      return { ...t, notice: `Retrying (attempt ${d.attempt}): ${errorText(d.error) ?? "provider error"}` };

    case "session.text.started":
    case "session.text.delta":
    case "session.text.ended":
      return updateAssistant(t, mid!, (parts) =>
        upsertPart(
          parts,
          `t:${d.ordinal}`,
          () => ({ kind: "text", key: `t:${d.ordinal}`, text: "" }),
          (p) => (p.kind !== "text" ? p : { ...p, text: type.endsWith("delta") ? p.text + d.delta : (d.text ?? p.text) }),
        ),
      );

    case "session.reasoning.started":
    case "session.reasoning.delta":
    case "session.reasoning.ended":
      return updateAssistant(t, mid!, (parts) =>
        upsertPart(
          parts,
          `r:${d.ordinal}`,
          () => ({ kind: "reasoning", key: `r:${d.ordinal}`, text: "", done: false }),
          (p) =>
            p.kind !== "reasoning"
              ? p
              : type.endsWith("delta")
                ? { ...p, text: p.text + d.delta }
                : type.endsWith("ended")
                  ? { ...p, text: d.text ?? p.text, done: true }
                  : p,
        ),
      );

    case "session.tool.input.started":
    case "session.tool.called":
    case "session.tool.success":
    case "session.tool.failed":
      return updateAssistant(t, mid!, (parts) =>
        upsertPart(
          parts,
          `tool:${d.id}`,
          () => ({ kind: "tool", key: `tool:${d.id}`, id: d.id, name: d.name ?? "tool", status: "pending" }),
          (p) => {
            if (p.kind !== "tool") return p;
            if (type === "session.tool.input.started") return { ...p, name: d.name ?? p.name };
            if (type === "session.tool.called") return { ...p, status: "running", input: d.input };
            if (type === "session.tool.success") return { ...p, status: "completed", output: toolOutput(d.content) };
            return { ...p, status: "error", error: errorText(d.error) };
          },
        ),
      );

    case "session.execution.succeeded":
      return { ...t, busy: false, notice: undefined };
    case "session.execution.failed":
      return { ...t, busy: false, notice: `Failed: ${errorText(d.error) ?? "unknown error"}` };
    default:
      // Any other terminal execution event (e.g. interrupted) ends the run.
      if (type.startsWith("session.execution.")) return { ...t, busy: false, notice: type.endsWith("interrupted") ? "Stopped." : t.notice };
      return t;
  }
}

/** After a run ends we re-fetch history to reconcile with the source of truth. */
export const shouldReconcile = (type: string) => type.startsWith("session.execution.") && type !== "session.execution.started";

const MEDIA_RE = /\/[^\s"'`]*\/\.lazylink\/media\/([\w.-]+\.(?:png|jpe?g))/g;

/** Screenshot paths produced by the macos tools, as URLs the PWA can load. */
export function mediaUrls(text: string | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(MEDIA_RE)].map((m) => `/media/${m[1]}`))];
}

// Tool output is often JSON-encoded, so a link can be followed by a literal "\n"; stop at backslashes.
const FILE_RE = /\/files\/([\w-]{16,})\/([^\s"'`)\]\\]+)/g;

/** Download links created by the agent's share_file tool. */
export function fileLinks(text: string | undefined): { url: string; name: string }[] {
  if (!text) return [];
  const seen = new Map<string, { url: string; name: string }>();
  for (const m of text.matchAll(FILE_RE)) {
    const url = `/files/${m[1]}/${m[2]}`;
    let name = m[2];
    try {
      name = decodeURIComponent(m[2]);
    } catch {}
    seen.set(m[1], { url, name });
  }
  return [...seen.values()];
}
