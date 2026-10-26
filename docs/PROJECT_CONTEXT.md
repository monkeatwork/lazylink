# lazylink: project context

A short brief for anyone (or any agent) starting work on this repo. For setup steps see the [README](../README.md); for history see [CHANGELOG](CHANGELOG.md).

## What it is

lazylink lets me control my Mac from my phone through a chat app, without screen sharing (no AnyDesk/TeamViewer). I type what I want; an AI agent running on the Mac does it with real tools (files, shell, apps, a logged-in browser) and sends results back to the chat. Anything risky waits for my Allow/Deny on the phone.

Key ideas:
- **Phone-first and remote.** I am never assumed to be at the Mac. Files come to me as download links; files I send land on the Mac.
- **Private.** Reachable only inside my Tailscale network. Nothing is exposed to the public internet.
- **No paid AI required.** The agent harness is [opencode](https://opencode.ai) (open source). Models are swappable: GitHub Copilot (GPT-4.1, included in the plan), opencode's free models, Ollama, or any API key.
- **Safe by default.** Ask-before-acting permissions, hard denies on sensitive paths, and a full audit log.

## What it can do

| Area | Capability |
| --- | --- |
| Chat with the Mac | Natural-language requests; the agent reads, searches, edits files and runs shell commands |
| Files → phone | "Send me my OS assignment": the agent calls `share_file` and a download card appears in chat (link needs login, expires in 24h, folders are zipped) |
| Files → Mac | 📎 in the composer or Android **Share → lazylink**; files land in `~/lazylink-inbox/<date>/` and the agent is told the paths |
| macOS control | Screenshots, AppleScript/JXA, open apps/files/URLs, list running apps, clipboard, notifications, system info |
| Browser | Playwright MCP drives a separate Chrome profile that has only the accounts I logged in to for the agent. My personal browser (Zen) is never touched |
| Approvals | Risky tool calls become Allow/Deny cards on the phone; optional per-chat auto-approve (hard denies still apply) |
| Push notifications | Approval needed, task done/failed, or the agent pinging me with `notify_phone`. Skipped while the app is on screen |
| Memory and context | Operating manual (`agent/LAZYLINK.md`), an editable "About me" profile, and agent memory via `remember`/`forget` |
| Quick actions (no AI) | Screenshot, status/battery, lock, volume, play/pause, keep-awake |
| Claude Code launcher | Pick a folder → new / continue / resume a Claude Code session in a WezTerm tab with Remote Control on, so I can drive it from the Claude app. Detects already-open sessions; a "Trust this folder" button answers Claude Code's trust prompt only when I tap it |
| Activity | Live, filterable timeline of every prompt, command, approval, file transfer and quick action |
| App | Installable PWA (Android WebAPK): own icon, no address bar, share-sheet target, push |

## How it works

```
phone (PWA) ──Tailscale HTTPS (tailscale serve)──▶ lazylink server (Hono, 127.0.0.1:8787)
                     ├─ auth (passcode + Tailscale identity), audit log, approval relay, SSE to the app
                     ├─ /files (expiring shares), /api/upload, web push, quick actions, Claude launcher
                     ├─ /mcp: lazylink's own MCP server (bearer token)
                     └─▶ opencode serve (127.0.0.1:4096, spawned + supervised)
                           ├─ instructions: agent/LAZYLINK.md + profile.md + memory.md
                           ├─ built-in tools: read / edit / bash / grep / glob / web
                           ├─ MCP lazylink   → share_file, list_inbox, remember, forget, notify_phone,
                           │                   start_claude, list_claude_sessions
                           ├─ MCP macos      → screenshot, run_script, open, list_apps, clipboard_read,
                           │                   clipboard_write, notify, system_info
                           └─ MCP playwright → agent-only Chrome over CDP (127.0.0.1:9222)
```

- Runs 24/7 as a launchd agent (`com.lazylink.server`, KeepAlive). Restart with `launchctl kickstart -k gui/$(id -u)/com.lazylink.server`.
- Data lives in `~/.lazylink` (0700): audit db, shares, push subscriptions, profile, memory, secrets, the agent's Chrome profile.
- opencode's v2 HTTP API is experimental, so `apps/server/src/opencode.ts` is a small hand-written client against it.
- Copilot is wired as a custom OpenAI-compatible provider (`providers.copilot` in `opencode.jsonc`) because opencode's built-in Copilot provider drops its models after the first prompt.

## Repo map

| Path | What it is |
| --- | --- |
| `apps/server/src` | Hono server. `index.ts` routes, `opencode.ts` harness client + supervisor, `mcp.ts` lazylink MCP tools, `claude.ts` Claude Code launcher, `shares.ts`, `push.ts`, `quick.ts`, `audit.ts`, `auth.ts`, `chrome.ts`, `paths.ts` (denied paths) |
| `apps/web/src` | React 19 + Vite PWA: chat, transcript cards, approvals, Activity, Settings, quick actions, launcher |
| `packages/mac-tools-mcp` | Standalone macOS MCP server (works with any MCP harness) |
| `agent/` | The agent's operating manual and the profile template |
| `opencode.example.jsonc` | Permissions, MCP servers and providers (rendered to `~/.lazylink/opencode.jsonc`) |
| `scripts/` | `setup.sh`, `install-launchd.sh` |

Stack: TypeScript, Node (node:sqlite), Hono, React 19, Vite, MCP SDK, Playwright MCP, web-push, Tailscale.

## Hard rules (do not break)

- Never expose anything to the public internet. Servers bind to `127.0.0.1`; outside access is only via `tailscale serve` (no Funnel).
- The agent must never touch `~/.ssh`, Keychains, the Zen browser profile, or lazylink's own data in `~/.lazylink` (except screenshots/media). `sudo` is denied.
- Never print or commit secrets: `.env` (passcode), `opencode.jsonc`, tokens in `~/.lazylink`. Both config files are gitignored.
- Claude Code's folder-trust prompt is only answered on an explicit user tap. Don't automate it.
- Risky actions must keep going through the Allow/Deny approval flow, and everything must stay in the audit log.

## Direction

The plan is to use **Hermes Agent** (Nous Research) as the main "brain" (messaging apps, skills, memory, scheduled jobs) and keep lazylink as its building blocks: the macOS and lazylink MCP servers, file transfer, the Claude Code launcher and the phone app's one-tap actions. Before switching, check that Hermes' approval model is as strict as lazylink's, that it works with the Copilot provider, that it can deliver files to the phone, and that it can call an HTTP MCP server with a bearer token.

Other ideas on the list: native Android app (Trusted Web Activity or Capacitor), a web terminal, scheduled tasks, Wake-on-LAN.
