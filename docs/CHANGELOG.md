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
