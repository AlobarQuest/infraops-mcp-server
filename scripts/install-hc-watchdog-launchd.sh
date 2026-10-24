#!/bin/bash
# Install (idempotent) the self-hosted Healthchecks watchdog LaunchAgent on this Mac.
# Needs INFRADRIFT_WATCHDOG_PING_URL (the hosted `alobar-healthchecks-watchdog` ping URL) in
# ~/.config/infra-drift/env, which this script never writes.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.devon.hc-watchdog.plist"
ENV_FILE="$HOME/.config/infra-drift/env"

grep -q '^INFRADRIFT_WATCHDOG_PING_URL=.' "$ENV_FILE" 2>/dev/null || {
  echo "Set INFRADRIFT_WATCHDOG_PING_URL in $ENV_FILE first, then re-run." >&2; exit 1; }

chmod +x "$REPO/scripts/hc-watchdog.sh"
sed -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
  "$REPO/scripts/com.devon.hc-watchdog.plist.template" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed + loaded com.devon.hc-watchdog (every 10 minutes; log ~/Library/Logs/hc-watchdog.log)."
