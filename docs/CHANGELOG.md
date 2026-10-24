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
