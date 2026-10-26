# Changelog

## 2026-10-08 — Initial build
- **What:** lazylink v0.1. A Hono server that supervises `opencode serve` and relays its events over SSE. It adds passcode and Tailscale-identity auth, an audit log in SQLite, and a dedicated agent Chrome. A React PWA provides chat, tool cards, approval cards and a model picker. `mac-tools-mcp` provides screenshots, AppleScript/JXA, apps, clipboard and notifications. The default permission ruleset lives in `opencode.example.jsonc`.
- **Why:** Remote, chat-based control of the Mac without screen sharing or a paid AI subscription. It runs on opencode, so free and local models work.
- **Files:** apps/server/*, apps/web/*, packages/mac-tools-mcp/*, opencode.example.jsonc, scripts/*, README.md
- **Known issues:** opencode v2's `/api` is experimental and newer than the published SDK. Agent Chrome, screenshots, Tailscale access and launchd are untested.
- **Next:** Install Tailscale, try it from the phone, and grant Screen Recording/Automation permissions.

## 2026-10-24 — Fix setup.sh silently exiting
- **What:** Generate the passcode with `openssl rand` instead of `tr </dev/urandom | head`. Fill an empty passcode even when `.env` already exists. Note that npm's allowScripts warnings are harmless.
- **Why:** Under `set -o pipefail`, the SIGPIPE from `tr` (exit 141) aborted the script right after creating `.env`. That left an empty passcode, no `opencode.jsonc` and no build.
- **Files:** scripts/setup.sh, docs/CHANGELOG.md
- **Known issues:** Same as above.
- **Next:** Install Tailscale and run `tailscale serve --bg 8787`.

## 2026-10-24 — Tailscale app support
- **What:** setup.sh finds the CLI bundled in the Tailscale Mac app. The README documents the app CLI path and the one-time "enable Serve" link. `LAZYLINK_ALLOWED_USERS` is set locally (in `.env`, not committed).
- **Why:** The Tailscale GUI app doesn't put `tailscale` on PATH, and Serve/HTTPS has to be enabled once per tailnet.
- **Files:** scripts/setup.sh, README.md, docs/CHANGELOG.md
- **Known issues:** Serve isn't enabled on the tailnet yet; that needs an admin-console click.
- **Next:** Enable Serve, run `serve --bg 8787`, then install the PWA on the phone.

## 2026-10-24 — Round 2: agent context, files both ways, push, quick actions, Activity, app-grade PWA
- **What:**
  - **Agent context.** `agent/LAZYLINK.md` is the operating manual: the user is remote on their phone, send files with `share_file`, uploads arrive in `~/lazylink-inbox`. Also an editable profile and agent memory (opencode `instructions`), plus live per-session context: time, device and the latest memory.
  - **lazylink MCP server** at `/mcp` (bearer token) with `share_file`, `list_inbox`, `remember`, `forget` and `notify_phone`.
  - **Downloads.** Expiring, login-protected links at `/files/<token>/<name>` (folders zipped, deny-list enforced) and download cards in chat.
  - **Uploads** from the phone: the 📎 button and the Android share sheet (`share_target` + service worker).
  - **Web Push.** VAPID keys, subscriptions, pushes for approvals and finished or failed tasks, suppressed while the app is on screen.
  - **Quick actions.** Screenshot, status, lock, play/pause, volume and keep-awake, with no model involved.
  - **Activity screen.** Filterable, day-grouped, live audit timeline.
  - **Settings.** Install the app, notifications, and the profile and memory editors.
  - **Installable PWA.** Maskable and monochrome icons, shortcuts, screenshots, `share_target`, deep links.
  - **Permissions.** `~/.lazylink` is 0700 and its files 0600. The agent is denied read, edit and shell access to lazylink's data dir (except screenshots).
  - Shared macOS helpers in `packages/mac-tools-mcp/src/mac.ts`. A clear error when Screen Recording permission is missing. `LAZYLINK_DATA_DIR` in `.env` now works.
- **Why:** The agent assumed the user was at the Mac and couldn't deliver files. The audit log had no UI and was world-readable. Running in a Chrome tab felt unlike an app.
- **Files:** agent/*, apps/server/src/{index,config,audit,opencode,db,mcp,paths,push,quick,shares}.ts, apps/web/src/{App,api,push,transcript}.ts(x), apps/web/src/components/{Activity,Composer,FileCard,Messages,QuickActions,Settings,Sheet,Sidebar}.tsx, apps/web/public/*, packages/mac-tools-mcp/src/{index,mac}.ts, opencode.example.jsonc, README.md, scripts/install-launchd.sh
- **Verified:**
  - File modes. `/mcp` returns 401 without the token.
  - `share_file` on a file and a folder works; `~/.ssh` and lazylink data are refused.
  - Download returns 200 with login, 401 without, 410 when expired, 404 for a bad token. Uploads de-duplicate names.
  - Audit filters, the `before` cursor, and live updates. Context and memory APIs. Quick actions: status and keep-awake.
  - A free model used `share_file` for "send me the report" and answered setup and memory questions correctly.
  - UI flows at 390×844 in headless Chrome. The service worker registers, and the manifest has maskable icons, `share_target` and shortcuts.
- **Known issues:**
  - Push hasn't been verified on a real phone yet.
  - Screenshots need the Screen Recording permission on the Mac.
  - Shared text from other apps prefills the composer, but shared files only arrive once the service worker is active (after the first open of the installed app).
- **Next:** Install as an app on the phone, enable notifications and run the test push. Later: TWA/Capacitor APK, browser screenshots in chat, a web terminal, scheduled tasks.

## 2026-10-25 — Runs 24/7; GitHub Copilot models
- **What:**
  - lazylink now runs permanently as the launchd agent `com.lazylink.server` (`scripts/install-launchd.sh`: starts at login, restarts if it crashes) rather than on a 1-hour timer.
  - New `copilot` provider in `opencode.jsonc`. It calls `https://api.githubcopilot.com` directly with the token from `opencode auth login` -> GitHub Copilot, which the server reads from opencode's database and renders into the 0600 config as `${COPILOT_TOKEN}`. Models: GPT-4.1 (the default via `LAZYLINK_MODEL=copilot/gpt-4.1`), Claude Haiku 4.5 and Kimi K3. The app hides them when there's no Copilot login.
- **Why:**
  - lazylink is the always-on way into the Mac.
  - opencode's free models hit "Free usage limit reached".
  - opencode 2.0.15's built-in `github-copilot` provider lists no models for this account, because Copilot reports `model_picker_enabled: false`. The first prompt works, and afterwards every prompt fails with `ModelUnavailableError`. This was reproduced on a bare `opencode serve` with no lazylink config.
- **Files:** apps/server/src/{opencode,index}.ts, opencode.example.jsonc, README.md
- **Verified:** Two new conversations in a row on `copilot/gpt-4.1` ran `read` and `shell` tools and answered correctly. A minimal-config test server stayed working across repeated prompts.
- **Known issues:**
  - After logging in to Copilot again, restart the service: the token is read at startup.
  - Only models that support `/chat/completions` work through this provider (not the `/responses`-only GPT-5.6/6 Luna).
  - The Mac's sleep setting can still take lazylink offline.
- **Next:** Check whether a newer opencode fixes the built-in Copilot provider and drop the workaround if so. Then install the PWA and test push on the phone.

## 2026-10-25 — Fix download cards saving an HTML page
- **What:**
  - The file-link regex in `transcript.ts` now stops at backslashes.
  - `/files/:token/*` now serves the file by token alone, whatever follows it in the path.
- **Why:** MCP tool output arrives JSON-encoded, so a share link was followed by a literal `\n`. The card's URL became `…/PM.png\nExpires:`, and the browser turned `\` into `/`. That URL didn't match the download route, so the SPA fallback returned `index.html`, which the phone saved as the "download".
- **Files:** apps/web/src/transcript.ts, apps/server/src/index.ts
- **Verified:**
  - The regex extracts the correct name from the real tool output.
  - With a login, both the clean URL and the old broken one return the PNG (200).
- **Known issues:** Cards already in old chats use the broken URL, but they now download correctly too.
- **Next:** Install the PWA and test push on the phone.

## 2026-10-26 — Claude Code launcher with Remote Control
- **What:**
  - A new "Claude Code" quick action:
    - pick a folder by typing it or tapping a recent project (from `~/.claude/projects`)
    - then choose **New session** (creates the folder if needed), **Continue latest**, or **Resume** one of that folder's sessions
  - The session opens with `wezterm cli spawn … claude --remote-control [--continue | --resume <id>]` in a login shell. If WezTerm isn't running, `wezterm start` opens it; if WezTerm isn't installed, it falls back to Terminal.app.
  - Sessions already open on the Mac (from `~/.claude/sessions/*.json`) are marked and can't be resumed twice.
  - New MCP tools `lazylink_start_claude` and `lazylink_list_claude_sessions` (both allowed), plus a line in the agent manual telling it to use them instead of typing into terminals.
- **Why:** Starting `claude`/`claude --resume` with `/rc` from the phone was a frequent multi-step job. GPT-4.1 refused to do it, and DeepSeek did it by typing keystrokes into WezTerm.
- **Files:** apps/server/src/{claude,index,mcp}.ts, apps/web/src/{api.ts,App.tsx,styles.css}, apps/web/src/components/{ClaudeLauncher,QuickActions}.tsx, agent/LAZYLINK.md, opencode.example.jsonc, README.md
- **Verified:**
  - The listing API returns 12 projects and this folder's sessions, with the open one marked, in about 0.1 s.
  - A real launch in a new folder opened a WezTerm tab. After the trust prompt was answered, it showed "/remote-control is active".
  - UI checked at 390×844.
- **Known issues:**
  - In a folder Claude Code hasn't opened before, the session waits at the "trust this folder" prompt, whose default is "No, exit". Answering it automatically was blocked as weakening a security control, so it's left to the user. The app warns when this will happen.
  - Session titles come from Claude's AI title or the first prompt, unless the session is open (then its live name).
- **Next:** Decide how to handle the trust prompt (trust a parent folder once, or a phone button that answers it on request).

## 2026-10-26 — Trust button and "already open" detection for the Claude Code launcher
- **What:**
  - **Trust this folder.** After a launch, the phone follows the tab (`GET /api/claude/pane/:pane`). When Claude Code asks whether to trust the folder, the phone shows a "Trust this folder" button. Tapping it (`POST /api/claude/pane/:pane/trust`) sends Down + Enter, which picks "Yes" (the default is "No, exit"). The server only sends the keys if that prompt is on screen, and audits it as `claude.trusted`. Tabs already waiting at the prompt, such as ones the agent opened, also appear with the button. The agent's `start_claude` tool tells the user to tap it rather than answering the prompt itself.
  - **Already open.** Continue and Resume check `~/.claude/sessions/*.json`. If the target session is running, they refuse with HTTP 409 and say whether Remote Control is on: "open it from the Claude app" if it is, "type /rc at the Mac or quit it" if not. Open sessions in the list show "open · Remote Control on/off", and Continue reads "Latest is open".
- **Why:** The launcher said it was turning Remote Control on even when the session was already running, and it opened a second copy. One session (pulseguard) was found running in two processes. New folders got stuck at the trust prompt.
- **Files:** apps/server/src/{claude,index,mcp}.ts, apps/web/src/{api.ts,styles.css}, apps/web/src/components/{ClaudeLauncher,QuickActions}.tsx
- **Verified:**
  - Continue on lazylink (open, Remote Control on) returns 409 with the right message.
  - New folder: the state goes to `trust`, the tab is listed as pending, the Trust endpoint returns `ready`, and the tab shows "/remote-control is active". Trust on a tab with no prompt returns 409.
  - The full UI flow at 390×844: launch, Trust card, tap, Remote Control card, and the "already open" notice.
- **Known issues:** Status tracking and the Trust button need WezTerm; the Terminal.app fallback has neither.
- **Next:** Look at Hermes Agent ideas (messaging gateways, skills, cron).

## 2026-10-26 — Repo made public
- **What:** `monkeatwork/lazylink` switched from private to public, for a LinkedIn post series (kept in a separate vault, `~/projects/lazylink-linkedin`).
- **Why:** Sharing the project.
- **Checked first:** The full git history has no passcode, tokens, keys, email or Tailscale hostname. `.env` and `opencode.jsonc` were never committed, and commits use a GitHub noreply address.
- **Files:** docs/CHANGELOG.md
- **Next:** Hermes Agent trial with lazylink's MCP servers.

## 2026-10-26 Project context brief
- **What:** added `docs/PROJECT_CONTEXT.md`, a one-page brief of what lazylink is, what it can do, how it's wired, the hard rules and the direction.
- **Why:** to hand to another agent or collaborator as a starting point.
- **Files:** `docs/PROJECT_CONTEXT.md`, `docs/CHANGELOG.md`
- **Known issues:** none.
- **Next:** keep it updated as the Hermes integration lands.
