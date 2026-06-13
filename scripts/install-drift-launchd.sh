#!/bin/bash
# Install (idempotent) the daily drift-audit LaunchAgent on this Mac.
# Renders the plist template, ensures the report dir + a gitignored secrets file,
# and loads the agent. Secrets are never written by this script — you fill them in.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.devon.infra-drift.plist"
ENV_FILE="$HOME/.config/infra-drift/env"

mkdir -p "$HOME/.config/infra-drift" "$HOME/infra-drift/reports" "$HOME/Library/LaunchAgents"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# Drift-audit secrets — gitignored, never commit. (chmod 600)
# BWS_ACCESS_TOKEN: a BWS machine token that can read prod-coolify-api-token,
#   local-coolify-api, INFRABRAIN_ACCESS_KEY, resend-api-key, anthropic-api-key.
# INFRADRIFT_HC_PING_URL: the Healthchecks.io check ping URL.
BWS_ACCESS_TOKEN=
INFRADRIFT_HC_PING_URL=
EOF
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE — fill in BWS_ACCESS_TOKEN + INFRADRIFT_HC_PING_URL, then re-run."
  exit 0
fi

chmod +x "$REPO/scripts/drift-audit.sh"
sed -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" \
  "$REPO/scripts/com.devon.infra-drift.plist.template" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed + loaded com.devon.infra-drift (daily 03:00)."
echo "Run once now:  launchctl start com.devon.infra-drift   (or: bash $REPO/scripts/drift-audit.sh)"
