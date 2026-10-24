#!/bin/bash
# One-time setup for lazylink. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "Node.js 22.13+ is required (https://nodejs.org or nvm)."; exit 1; }
if ! command -v opencode >/dev/null && [ ! -x "$HOME/.opencode/bin/opencode" ]; then
  echo "opencode is not installed. Install it with:  curl -fsSL https://opencode.ai/install | bash"; exit 1
fi

echo "→ Installing dependencies"
# npm 11 may warn that esbuild/fsevents install scripts aren't in allowScripts; that's harmless here.
npm install --no-fund --no-audit

[ -f .env ] || { cp .env.example .env; echo "→ Created .env"; }
if grep -q '^LAZYLINK_PASSCODE=$' .env; then
  pass=$(openssl rand -hex 10)
  sed -i '' "s/^LAZYLINK_PASSCODE=$/LAZYLINK_PASSCODE=$pass/" .env
  echo "→ Set your passcode: $pass   (change it in .env if you like)"
fi
[ -f opencode.jsonc ] || { cp opencode.example.jsonc opencode.jsonc; echo "→ Created opencode.jsonc (permissions, MCP servers, models)"; }

echo "→ Building the web app"
npm run build

cat <<MSG

✓ lazylink is ready.

  Run it:            npm start               (then open http://127.0.0.1:8787)
  Run at login:      scripts/install-launchd.sh

  Reach it from your phone (private, no public ports):
    1. Install Tailscale on the Mac and your phone, sign in to both with the same account.
    2. On the Mac:   tailscale serve --bg 8787
    3. On the phone: open https://<mac-name>.<tailnet>.ts.net, then "Add to Home Screen".
    4. Put your Tailscale login in LAZYLINK_ALLOWED_USERS in .env.

  Agent browser: the first time, click "start" next to "agent Chrome" (or it auto-starts)
  and log in to the accounts you want the agent to use. Your own browser stays untouched.
MSG
