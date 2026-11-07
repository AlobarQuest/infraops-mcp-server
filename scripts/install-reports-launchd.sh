#!/bin/bash
# Install (idempotent) the 07:30 report-send LaunchAgent on this Mac. It sends the digests that
# drift-audit.sh and change-window.sh queue overnight. Needs the same Keychain BWS token as those
# jobs (account BWS_ACCESS_TOKEN_INFRA_DRIFT). For its heartbeat, add INFRADRIFT_REPORTS_HC_PING_URL
# (the Healthchecks check `infra-reports`) to $HOME/.config/infra-drift/env.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.devon.infra-reports.plist"

mkdir -p "$HOME/infra-drift/outbox" "$HOME/Library/LaunchAgents"
chmod +x "$REPO/scripts/send-reports.sh"
sed -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
  "$REPO/scripts/com.devon.infra-reports.plist.template" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed + loaded com.devon.infra-reports (daily 07:30)."
echo "Run once now:  launchctl start com.devon.infra-reports   (or: bash $REPO/scripts/send-reports.sh)"
