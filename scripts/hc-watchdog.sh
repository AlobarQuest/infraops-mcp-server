#!/bin/bash
# Outside watchdog for self-hosted Healthchecks (healthcheck.alobar.net).
#
# Every 10 minutes (launchd com.devon.hc-watchdog) this asks the self-hosted instance for its
# status and, only when it answers `OK`, pings the hosted Healthchecks.io check
# `alobar-healthchecks-watchdog`. When the instance, the VPS, Cloudflare or this Mac stops working,
# the pings stop and hosted Healthchecks.io emails Devon. It must stay on hosted: a monitor can't
# report on the host it runs on (infra-brain lesson #275).
#
# The hosted ping URL is INFRADRIFT_WATCHDOG_PING_URL in the gitignored ~/.config/infra-drift/env.
# Quiet on success; one log line per failure.
set -uo pipefail

CONFIG="${INFRADRIFT_ENV:-$HOME/.config/infra-drift/env}"
if [ -f "$CONFIG" ]; then set -a; . "$CONFIG"; set +a; fi

STATUS_URL="https://healthcheck.alobar.net/api/v3/status/"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [hc-watchdog] $*"; }

PING_URL="${INFRADRIFT_WATCHDOG_PING_URL:-}"
[ -n "$PING_URL" ] || { log "INFRADRIFT_WATCHDOG_PING_URL is not set in $CONFIG"; exit 1; }

# Cloudflare fronts the instance; curl's default User-Agent passes its browser check.
body="$(curl -fsS --max-time 15 "$STATUS_URL" 2>&1)" || { log "status request failed: $body"; exit 1; }
[ "$body" = "OK" ] || { log "status answered '${body:0:80}', not OK"; exit 1; }

curl -fsS --max-time 10 --retry 2 "$PING_URL" >/dev/null 2>&1 \
    || { log "self-hosted is OK but the hosted ping failed"; exit 1; }
