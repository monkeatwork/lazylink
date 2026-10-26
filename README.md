# ⌘ lazylink

Chat with your Mac from your phone. You type what you want and an AI agent does it on your Mac: files, shell, apps and a browser that's logged in to your accounts. Risky actions wait for your approval.

There's no screen sharing and no Claude subscription required. lazylink runs on [opencode](https://opencode.ai), an open-source agent harness, so you can use **free models** (opencode's free tier or a local model through Ollama) or any provider you have a key for.

```
phone (installed PWA) ──Tailscale HTTPS──▶ lazylink server (127.0.0.1:8787)
                                   ├─ passcode + Tailscale identity, audit log + Activity screen, approval relay
                                   ├─ file links (/files), phone uploads (~/lazylink-inbox), web push, quick actions
                                   ├─ /mcp: lazylink's own MCP tools (share_file, list_inbox, remember, notify_phone)
                                   └─▶ opencode serve (127.0.0.1:4096, spawned + supervised)
                                         ├─ instructions: agent/LAZYLINK.md + your profile + agent memory
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
2. On the Mac, run `tailscale serve --bg 8787`. If you have the Tailscale app rather than the CLI, the command is `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 8787`. You can add `alias tailscale=/Applications/Tailscale.app/Contents/MacOS/Tailscale` to `~/.zshrc`. The first time, it prints a link that turns on Serve/HTTPS for your tailnet. Open it, then run the command again.
3. On your phone, open `https://<mac-name>.<tailnet>.ts.net` in Chrome, then tap ⋮ → **Install app**. Don't use "Add to Home screen", which only makes a shortcut. The installed app gets its own icon, opens without an address bar, receives notifications, and appears in the Android share sheet.
4. Add your Tailscale login to `LAZYLINK_ALLOWED_USERS` in `.env`.

Development: `npm run dev` runs the server with reload plus Vite on :5173.

## What the agent knows about you

The model is told how lazylink works, so it doesn't assume you're sitting at the Mac:

- **`agent/LAZYLINK.md`** is the operating manual, loaded into every conversation. It says you're remote on your phone, that files go to you through `share_file`, that uploads land in `~/lazylink-inbox`, and that answers should be phone-sized.
- **About me** (`~/.lazylink/profile.md`): where your things live, accounts and preferences. Edit it in **Settings**.
- **Agent memory** (`~/.lazylink/memory.md`): when you say "remember that…", the agent saves it with its `remember` tool. You can view and edit it in **Settings**.
- **Live context:** before each message, lazylink tells the agent the date and time, which device you're on, and the latest memory.

## Features

- **Files to your phone:** "send me the newest PDF in Downloads" → the agent calls `share_file` and a download card appears in chat. Links need your login, expire after 24h (`LAZYLINK_SHARE_TTL_HOURS`), and are logged. Folders are zipped. SSH keys, Keychains, your Zen profile and lazylink's own data can't be shared.
- **Files to your Mac:** 📎 in the composer, or **Share → lazylink** from any Android app. Files land in `~/lazylink-inbox/<date>/`, and the agent is told the paths.
- **Notifications:** Settings → Notifications → Turn on. You get a push when the agent needs an approval or finishes or fails a task while the app isn't on screen. The agent can also ping you with `notify_phone`.
- **Quick actions (⚡):** screenshot, status, lock, play/pause, volume, keep-awake. They run instantly, with no AI and no cost.
- **Claude Code launcher (⚡ → Claude Code):** pick a folder (recent projects are one tap), then start a new session, continue the latest, or resume a past one. It opens in a WezTerm tab on the Mac (Terminal.app if WezTerm isn't installed) with `claude --remote-control`, so you can drive it from the Claude app or claude.ai/code. Sessions that are already open are marked and can't be resumed twice. The agent can do the same with `lazylink_start_claude`. In a folder Claude Code hasn't opened before, it first asks in the terminal whether to trust the folder.
- **Activity:** a timeline of every prompt, command, approval, file transfer and quick action, with filters. It updates live.

## Models

Use the model picker in the app, or set `LAZYLINK_MODEL=provider/model` in `.env`.

- **Free, no setup:** opencode's free models (marked "Free" in the picker). Availability changes, and a free model can be overloaded at times. opencode retries automatically.
- **Free, local, private:** run Ollama, then uncomment the `providers.ollama` block in `opencode.jsonc`. Pick a model that supports tool calling. Small models struggle with multi-step tasks.
- **GitHub Copilot (free for students, or Copilot Pro):** run `opencode auth login`, choose GitHub Copilot and sign in to the account that has Copilot. Then restart lazylink. GPT-4.1, Claude Haiku 4.5 and Kimi K3 appear as "(Copilot)" in the picker, and GPT-4.1 doesn't use premium requests. lazylink calls the Copilot API directly with that login (see `providers.copilot` in `opencode.jsonc`), because opencode 2.0.15's built-in Copilot provider loses its models after the first prompt. Enable models at github.com/settings/copilot. Any model you add to that block must support `/chat/completions`.
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
- **Audit:** every prompt, tool call, approval, denial, file transfer and quick action is written to `~/.lazylink/audit.db` (readable only by you) and shown in the **Activity** screen.
- **Private data:** `~/.lazylink` is `0700`; secrets, logs and the database are `0600`. The agent is denied read, edit and shell access to it (except screenshots).
- **lazylink's MCP endpoint** (`/mcp`) requires a bearer token that only opencode has.

## Layout

| Path | What it is |
| --- | --- |
| `apps/server` | Hono server: auth, opencode supervisor + v2 API client, SSE relay, audit log, agent Chrome, lazylink MCP tools, shares, uploads, push, quick actions |
| `apps/web` | React PWA: conversations, streaming transcript, tool/approval/download cards, Activity, Settings, quick actions, share target |
| `agent/` | The agent's operating manual and the profile template |
| `packages/mac-tools-mcp` | Standalone MCP server for macOS automation. It works with any MCP-capable harness. |
| `opencode.example.jsonc` | Default permissions + MCP servers (copied to `opencode.jsonc`) |

`macos_screenshot` and `macos_list_apps` need macOS privacy permissions the first time. Grant **Screen Recording** and **Automation** to the process running lazylink (Terminal, or `node` when it runs under launchd).

## Notes

opencode v2's HTTP API (`/api/*`) is marked experimental and is ahead of the published `@opencode-ai/sdk`. For that reason lazylink uses a small fetch client (`apps/server/src/opencode.ts`) written against the live OpenAPI spec of opencode 2.0.x. If an opencode upgrade breaks something, start there.
