import DOMPurify from "dompurify";
import { marked } from "marked";
import { memo, useMemo, useState } from "react";
import { mediaUrls, type Msg, type Part } from "../transcript.ts";

marked.setOptions({ gfm: true, breaks: true });

const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
});

function Media({ text }: { text?: string }) {
  const urls = mediaUrls(text);
  if (!urls.length) return null;
  return (
    <div className="media">
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer">
          <img src={u} alt="screenshot" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

/** One-line summary of what a tool call is doing, for the collapsed card. */
function summarize(name: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  if (typeof input.command === "string") return input.command;
  if (typeof input.code === "string") {
    const calls = [...input.code.matchAll(/tools\.(\w+)\[?["']?(\w+)?/g)].map((m) => (m[2] ? `${m[1]}.${m[2]}` : m[1]));
    return calls.length ? [...new Set(calls)].join(", ") : input.code.split("\n")[0];
  }
  for (const k of ["filePath", "path", "pattern", "url", "query", "target"]) if (typeof input[k] === "string") return input[k];
  return name === "execute" ? "" : JSON.stringify(input).slice(0, 120);
}

const TOOL_LABEL: Record<string, string> = {
  shell: "Shell",
  read: "Read",
  edit: "Edit",
  write: "Write",
  grep: "Search",
  glob: "Find files",
  webfetch: "Fetch",
  websearch: "Web search",
  execute: "Tools",
};

function ToolCard({ part }: { part: Extract<Part, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const summary = summarize(part.name, part.input);
  const body = part.error ?? part.output;
  // A lone {command} is already shown in the header; don't repeat it as JSON.
  const input = part.input as any;
  const showInput = input !== undefined && !(input && Object.keys(input).length === 1 && typeof input.command === "string");
  return (
    <div className={`tool ${part.status}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className={`tool-status ${part.status}`} />
        <span className="tool-name">{TOOL_LABEL[part.name] ?? part.name}</span>
        <span className="tool-summary mono">{summary}</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="tool-body">
          {showInput && <pre className="mono">{typeof input?.code === "string" ? input.code : JSON.stringify(input, null, 2)}</pre>}
          {body && <pre className={`mono ${part.error ? "error-text" : ""}`}>{body.length > 8000 ? body.slice(0, 8000) + "\n…" : body}</pre>}
        </div>
      )}
      <Media text={part.output} />
    </div>
  );
}

function Reasoning({ part }: { part: Extract<Part, { kind: "reasoning" }> }) {
  const [open, setOpen] = useState(false);
  if (!part.text.trim()) return null;
  return (
    <div className="reasoning" onClick={() => setOpen(!open)}>
      <span className="muted">{part.done ? "Thought" : "Thinking…"}</span>
      {open && <div className="reasoning-text">{part.text}</div>}
    </div>
  );
}

export const Message = memo(function Message({ msg }: { msg: Msg }) {
  if (msg.role === "user") return <div className="msg user">{msg.text}</div>;
  if (msg.role === "system") return <div className="msg system">{msg.text}</div>;
  return (
    <div className="msg assistant">
      {msg.parts.map((p) =>
        p.kind === "text" ? (
          <div key={p.key}>
            <Markdown text={p.text} />
            <Media text={p.text} />
          </div>
        ) : p.kind === "reasoning" ? (
          <Reasoning key={p.key} part={p} />
        ) : (
          <ToolCard key={p.key} part={p} />
        ),
      )}
      {msg.error && <div className="error-text">{msg.error}</div>}
    </div>
  );
});
