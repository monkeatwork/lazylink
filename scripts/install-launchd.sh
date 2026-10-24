#!/bin/bash
# Keeps lazylink running in the background and starts it at login (macOS launchd).
# Uninstall: launchctl bootout gui/$(id -u)/com.lazylink.server && rm ~/Library/LaunchAgents/com.lazylink.server.plist
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.lazylink.server.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.lazylink"
chmod 700 "$HOME/.lazylink"
touch "$HOME/.lazylink/server.log" && chmod 600 "$HOME/.lazylink/server.log"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lazylink.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/node_modules/tsx/dist/cli.mjs</string>
    <string>$ROOT/apps/server/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE"):$HOME/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.lazylink/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.lazylink/server.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/com.lazylink.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ lazylink runs in the background now (logs: ~/.lazylink/server.log)."
echo "  Tip: keep the Mac reachable with System Settings → Battery → Options → 'Prevent automatic sleeping when the display is off' and 'Wake for network access'."
