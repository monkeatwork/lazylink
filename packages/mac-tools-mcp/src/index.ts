#!/usr/bin/env -S npx tsx
// lazylink mac-tools: a small stdio MCP server that gives an agent macOS superpowers.
// It is harness-agnostic: opencode, Claude Code, Cursor, etc. can all load it.
import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const run = promisify(execFile);
const MEDIA_DIR = process.env.LAZYLINK_MEDIA_DIR ?? join(homedir(), ".lazylink", "media");
const TIMEOUT_MS = 30_000;

async function sh(cmd: string, args: string[], input?: string): Promise<string> {
  if (input === undefined) {
    const { stdout } = await run(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trimEnd();
  }
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: TIMEOUT_MS }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trimEnd()),
    );
    child.stdin?.end(input);
  });
}

function osascript(script: string, language: "applescript" | "javascript" = "applescript") {
  const args = language === "javascript" ? ["-l", "JavaScript", "-e", script] : ["-e", script];
  return sh("osascript", args);
}

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
      await mkdir(MEDIA_DIR, { recursive: true });
      const file = join(MEDIA_DIR, `screenshot-${Date.now()}.png`);
      const args = ["-x", "-t", "png"];
      if (display) args.push("-D", String(display));
      if (window) {
        const id = await osascript(
          'tell application "System Events" to get id of first window of (first process whose frontmost is true)',
        ).catch(() => "");
        if (id) args.push("-l", id);
      }
      await sh("screencapture", [...args, file]);
      // Downscale a copy for the model so screenshots don't blow the context window.
      const small = file.replace(/\.png$/, ".small.png");
      await sh("sips", ["-Z", "1440", file, "--out", small]);
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
  async () => {
    const parts = await Promise.all([
      sh("sw_vers", []).catch(() => ""),
      sh("uptime", []).catch(() => ""),
      sh("pmset", ["-g", "batt"]).catch(() => ""),
      sh("df", ["-h", "/"]).catch(() => ""),
    ]);
    return text(parts.filter(Boolean).join("\n\n"));
  },
);

await server.connect(new StdioServerTransport());
