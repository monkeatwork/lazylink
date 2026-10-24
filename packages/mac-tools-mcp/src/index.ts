#!/usr/bin/env -S npx tsx
// lazylink mac-tools: a small stdio MCP server that gives an agent macOS superpowers.
// It is harness-agnostic: opencode, Claude Code, Cursor, etc. can all load it.
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { osascript, screenshot, sh, systemInfo } from "./mac.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t || "(no output)" }] });

function fail(err: unknown) {
  const e = err as { message?: string; stderr?: string };
  return { isError: true, content: [{ type: "text" as const, text: (e.stderr || e.message || String(err)).trim() }] };
}

const server = new McpServer({ name: "lazylink-mac-tools", version: "0.1.0" });

server.registerTool(
  "screenshot",
  {
    description:
      "Capture the Mac's screen. Returns the image plus the saved file path (show the path to the user so their UI can render it).",
    inputSchema: {
      display: z.number().int().min(1).optional().describe("Display number (1 = main). Omit for the main display."),
      window: z.boolean().optional().describe("If true, capture only the frontmost window."),
    },
  },
  async ({ display, window }) => {
    try {
      const { file, small } = await screenshot({ display, window });
      const data = (await readFile(small)).toString("base64");
      return {
        content: [
          { type: "image" as const, data, mimeType: "image/png" },
          { type: "text" as const, text: `Screenshot saved to ${file}` },
        ],
      };
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "run_script",
  {
    description:
      "Run AppleScript or JavaScript for Automation (JXA) via osascript. Use this to control scriptable apps (Finder, Safari, Mail, Music, Notes, System Events, ...). Returns the script result.",
    inputSchema: {
      script: z.string().describe("The script source."),
      language: z.enum(["applescript", "javascript"]).default("applescript"),
    },
  },
  async ({ script, language }) => {
    try {
      return text(await osascript(script, language));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "open",
  {
    description: "Open a file, folder, URL or application (like the `open` command).",
    inputSchema: {
      target: z.string().optional().describe("Path or URL to open."),
      app: z.string().optional().describe('Application name, e.g. "Finder", "Visual Studio Code".'),
    },
  },
  async ({ target, app }) => {
    if (!target && !app) return fail("Provide a target, an app, or both.");
    try {
      const args: string[] = [];
      if (app) args.push("-a", app);
      if (target) args.push(target);
      await sh("open", args);
      return text(`Opened ${[app, target].filter(Boolean).join(" → ")}`);
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_apps",
  {
    description: "List running GUI applications, their windows, and which app is frontmost.",
    inputSchema: {},
  },
  async () => {
    try {
      const out = await osascript(
        `const se = Application("System Events");
         const procs = se.processes.whose({ backgroundOnly: false })();
         JSON.stringify(procs.map(p => ({
           name: p.name(),
           frontmost: p.frontmost(),
           windows: (() => { try { return p.windows.name(); } catch (e) { return []; } })(),
         })), null, 1);`,
        "javascript",
      );
      return text(out);
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "clipboard_read",
  { description: "Read the current text contents of the clipboard.", inputSchema: {} },
  async () => {
    try {
      return text(await sh("pbpaste", []));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "clipboard_write",
  {
    description: "Replace the clipboard contents with the given text.",
    inputSchema: { text: z.string() },
  },
  async ({ text: value }) => {
    try {
      await sh("pbcopy", [], value);
      return text("Copied to clipboard.");
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "notify",
  {
    description: "Show a macOS notification on the Mac.",
    inputSchema: { title: z.string(), message: z.string() },
  },
  async ({ title, message }) => {
    try {
      await osascript(`display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`);
      return text("Notification shown.");
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "system_info",
  {
    description: "Battery, uptime, disk usage, macOS version and the current Wi-Fi/network state.",
    inputSchema: {},
  },
  async () => text(await systemInfo()),
);

await server.connect(new StdioServerTransport());
