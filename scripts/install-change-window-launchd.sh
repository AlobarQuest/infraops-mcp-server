#!/bin/bash
# Install (idempotent) the daily change-window LaunchAgent on this Mac.
# Renders the plist template, reuses the SAME env file as drift-audit
# ($HOME/.config/infra-drift/env — do NOT create a second env file), and loads
# the agent. Secrets are never written by this script — you fill them in.
#
# Note: add INFRADRIFT_CW_HC_PING_URL to the env file for Healthchecks.io pings
# from the change-window job (separate check from INFRADRIFT_HC_PING_URL used by
# the drift-audit job).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.devon.change-window.plist"
ENV_FILE="$HOME/.config/infra-drift/env"

mkdir -p "$HOME/.config/infra-drift" "$HOME/infra-drift/reports" "$HOME/Library/LaunchAgents"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# Drift-audit secrets — gitignored, never commit. (chmod 600)
# BWS_ACCESS_TOKEN: a BWS machine token that can read prod-coolify-api-token,
#   local-coolify-api, INFRABRAIN_ACCESS_KEY, resend-api-key, anthropic-api-key,
#   and change-mgr-m2m-token.
# INFRADRIFT_HC_PING_URL: the Healthchecks.io check ping URL for drift-audit.
# INFRADRIFT_CW_HC_PING_URL: the Healthchecks.io check ping URL for change-window.
BWS_ACCESS_TOKEN=
INFRADRIFT_HC_PING_URL=
INFRADRIFT_CW_HC_PING_URL=
EOF
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE — fill in BWS_ACCESS_TOKEN + INFRADRIFT_HC_PING_URL + INFRADRIFT_CW_HC_PING_URL, then re-run."
  exit 0
fi

chmod +x "$REPO/scripts/change-window.sh"
sed -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
  "$REPO/scripts/com.devon.change-window.plist.template" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed + loaded com.devon.change-window (daily 04:00)."
echo "Run once now:  launchctl start com.devon.change-window   (or: bash $REPO/scripts/change-window.sh)"
