// lazylink's own MCP server, mounted at /mcp and loaded by opencode as the "lazylink" server.
// These tools need lazylink's state (shares, push, memory, inbox), so they live here instead of in mac-tools.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { audit } from "./audit.ts";
import { INBOX_DIR, MEMORY_FILE } from "./config.ts";
import { push } from "./push.ts";
import { createShare, shareUrl } from "./shares.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (err: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (err as Error).message ?? String(err) }] });

const human = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

function buildServer() {
  const server = new McpServer({ name: "lazylink", version: "0.2.0" });

  server.registerTool(
    "share_file",
    {
      description:
        "Send a file or folder from this Mac to the user's phone. Returns a private download link that appears as a download card in the user's chat (folders are zipped; links expire after 24h). Use this whenever the user wants a file sent, shared, or opened on their phone.",
      inputSchema: {
        path: z.string().describe("Absolute path, or a path starting with ~"),
        note: z.string().optional().describe("Optional short note shown to the user"),
      },
    },
    async ({ path, note }) => {
      try {
        const s = await createShare(path);
        audit("file.shared", null, { path: s.path, name: s.name, size: s.size, expires: s.expires, note }, "agent");
        return text(
          `Shared ${s.name} (${human(s.size)}). The user now sees a download card for it in their chat.\nLink: ${shareUrl(s)}\nExpires: ${new Date(s.expires).toLocaleString()}`,
        );
      } catch (err) {
        audit("file.share-refused", null, { path, error: (err as Error).message }, "agent");
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_inbox",
    {
      description: "List recent files the user sent from their phone (they live in ~/lazylink-inbox/<date>/).",
      inputSchema: { limit: z.number().int().min(1).max(200).default(30) },
    },
    async ({ limit }) => {
      if (!existsSync(INBOX_DIR)) return text("The inbox is empty.");
      const files: { path: string; mtime: number; size: number }[] = [];
      for (const day of readdirSync(INBOX_DIR)) {
        const dir = join(INBOX_DIR, day);
        if (!statSync(dir).isDirectory()) continue;
        for (const f of readdirSync(dir)) {
          const st = statSync(join(dir, f));
          if (st.isFile()) files.push({ path: join(dir, f), mtime: st.mtimeMs, size: st.size });
        }
      }
      files.sort((a, b) => b.mtime - a.mtime);
      if (!files.length) return text("The inbox is empty.");
      return text(
        files
          .slice(0, limit)
          .map((f) => `${f.path}  (${human(f.size)}, ${new Date(f.mtime).toLocaleString()})`)
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "remember",
    {
      description:
        "Save a durable fact or preference about the user (where things are, how they like things done). It is loaded into every future conversation.",
      inputSchema: { fact: z.string().min(3).max(500) },
    },
    async ({ fact }) => {
      appendFileSync(MEMORY_FILE, `- ${fact.replace(/\s+/g, " ").trim()}  <!-- ${new Date().toISOString().slice(0, 10)} -->\n`);
      audit("memory.remember", null, { fact }, "agent");
      return text("Saved to memory.");
    },
  );

  server.registerTool(
    "forget",
    {
      description: "Remove remembered facts that contain the given text (case-insensitive).",
      inputSchema: { match: z.string().min(2) },
    },
    async ({ match }) => {
      const lines = readFileSync(MEMORY_FILE, "utf8").split("\n");
      const needle = match.toLowerCase();
      const kept = lines.filter((l) => !(l.startsWith("- ") && l.toLowerCase().includes(needle)));
      const removed = lines.length - kept.length;
      writeFileSync(MEMORY_FILE, kept.join("\n"));
      audit("memory.forget", null, { match, removed }, "agent");
      return text(removed ? `Removed ${removed} memory item(s).` : "Nothing in memory matched.");
    },
  );

  server.registerTool(
    "notify_phone",
    {
      description: "Send a push notification to the user's phone, e.g. when a long task finishes or something needs their attention.",
      inputSchema: { title: z.string().max(80), body: z.string().max(300) },
    },
    async ({ title, body }) => {
      const sent = await push({ title, body, tag: "agent" }, { force: true });
      audit("push.agent", null, { title, body, sent }, "agent");
      return text(sent ? "Notification sent." : "The user hasn't enabled notifications on any device yet.");
    },
  );

  return server;
}

/** Handles one MCP request. Stateless: a fresh server + transport per request keeps things simple. */
export async function handleMcp(req: Request): Promise<Response> {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

/** For prompts: describes uploaded files relative to the user's home. */
export const inboxNote = (paths: string[], home: string) =>
  `\n\n[Files I sent you from my phone, now on the Mac: ${paths.map((p) => "~/" + relative(home, p)).join(", ")}]`;
