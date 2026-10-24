# ⌘ lazylink

Chat with your Mac from your phone. You type what you want and an AI agent does it on your Mac: files, shell, apps and a browser that's logged in to your accounts. Risky actions wait for your approval.

There's no screen sharing and no Claude subscription required. lazylink runs on [opencode](https://opencode.ai), an open-source agent harness, so you can use **free models** (opencode's free tier or a local model through Ollama) or any provider you have a key for.

```
phone (PWA) ──Tailscale HTTPS──▶ lazylink server (127.0.0.1:8787)
                                   ├─ passcode + Tailscale identity, audit log, approval relay
                                   └─▶ opencode serve (127.0.0.1:4096, spawned + supervised)
                                         ├─ built-in tools: read / edit / shell / grep / glob / web
                                         ├─ MCP playwright → the agent's own Chrome profile (CDP :9222)
                                         ├─ MCP macos (packages/mac-tools-mcp) → screenshots, AppleScript/JXA,
                                         │     open apps, clipboard, notifications, system info
                                         └─ any model: free opencode models, Ollama, OpenRouter, …
```

## Quick start

```bash
scripts/setup.sh                # installs deps, creates .env (prints your passcode) and opencode.jsonc, builds the app
npm start                       # http://127.0.0.1:8787
scripts/install-launchd.sh      # optional: run in the background and start at login
```

Phone access (private; nothing is exposed to the internet):

1. Install [Tailscale](https://tailscale.com) on the Mac and on your phone, signed in to the same account.
2. On the Mac, run `tailscale serve --bg 8787`.
3. On your phone, open `https://<mac-name>.<tailnet>.ts.net`, then use **Add to Home Screen**.
4. Add your Tailscale login to `LAZYLINK_ALLOWED_USERS` in `.env`.

Development: `npm run dev` runs the server with reload plus Vite on :5173.

## Models

Use the model picker in the app, or set `LAZYLINK_MODEL=provider/model` in `.env`.

- **Free, no setup:** opencode's free models (marked "Free" in the picker). Availability changes, and a free model can be overloaded at times. opencode retries automatically.
- **Free, local, private:** run Ollama, then uncomment the `providers.ollama` block in `opencode.jsonc`. Pick a model that supports tool calling. Small models struggle with multi-step tasks.
- **Paid:** add a key with `opencode auth login` (or in `~/.config/opencode`), and those models start working in the picker.

Tool-calling quality matters more than raw intelligence here. If an agent loops or ignores tools, try a different model.

## The agent's browser

lazylink starts a separate Chrome with its own profile at `~/.lazylink/chrome` and remote debugging on `127.0.0.1:9222`. Playwright MCP controls that Chrome.

The first time, open that Chrome window on the Mac and log in to the accounts you want the agent to use. Your everyday browser (Zen, Safari, your normal Chrome profile) is never touched. Recent Chrome versions refuse remote debugging on the default profile anyway.

## Safety model

This is remote control of your computer, so lazylink is locked down by default:

- **Network:** both servers bind to `127.0.0.1`. The only way in from outside is `tailscale serve`, which only devices on your tailnet can reach.
- **Login:** a passcode (with a lockout after repeated failures) and an optional allowlist of Tailscale logins. Sessions use an httpOnly, SameSite=Strict cookie.
- **Permissions** (`opencode.jsonc`, last matching rule wins):
  - Allowed without asking: reading, searching, read-only shell commands, browser navigation and snapshots, screenshots.
  - Shows an Allow/Deny card on your phone: everything else.
  - Hard-denied: `sudo`, anything touching `~/.ssh` or Keychains, the Zen profile, and lazylink's own secrets.
- **Auto-approve:** a per-conversation toggle (the `ask` chip). It answers approval cards for you, but hard denies still apply. This has been tested: with auto-approve on, `cat ~/.ssh/config` was still blocked through both the shell and read tools.
- **Audit:** every prompt, tool call, approval and denial is written to `~/.lazylink/audit.db`. You can also read it at `GET /api/audit`.

## Layout

| Path | What it is |
| --- | --- |
| `apps/server` | Hono server: auth, opencode supervisor + v2 API client, SSE relay, audit log, agent Chrome |
| `apps/web` | React PWA: conversations, streaming transcript, tool cards, approval cards, model picker |
| `packages/mac-tools-mcp` | Standalone MCP server for macOS automation. It works with any MCP-capable harness. |
| `opencode.example.jsonc` | Default permissions + MCP servers (copied to `opencode.jsonc`) |

`macos_screenshot` and `macos_list_apps` need macOS privacy permissions the first time. Grant **Screen Recording** and **Automation** to the process running lazylink (Terminal, or `node` when it runs under launchd).

## Notes

opencode v2's HTTP API (`/api/*`) is marked experimental and is ahead of the published `@opencode-ai/sdk`. For that reason lazylink uses a small fetch client (`apps/server/src/opencode.ts`) written against the live OpenAPI spec of opencode 2.0.x. If an opencode upgrade breaks something, start there.
