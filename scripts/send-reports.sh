#!/bin/bash
# Morning report send — runs on the Mac mini via launchd (com.devon.infra-reports) at 07:30.
# drift-audit.sh (03:00) and change-window.sh (04:00) queue their digests instead of sending them,
# so the reports arrive after alert-hub's quiet hours; this job sends whatever is queued.
#
# Secrets: the bootstrap BWS_ACCESS_TOKEN comes from the macOS login Keychain (bws-token.sh), and
# the report token from BWS by UUID (load_alert_hub_tokens). Nothing is read from this repo.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/bws-token.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/report-notice.sh"

LOG_FILE="${INFRADRIFT_REPORTS_LOG:-$HOME/Library/Logs/infra-reports.log}"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

[ -n "${BWS_ACCESS_TOKEN:-}" ] || { log "FATAL: BWS_ACCESS_TOKEN not set (check the Keychain)"; exit 1; }

get_secret_by_id() {
  bws secret get "$1" --output json --color no 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])" 2>/dev/null || echo ""
}

# Healthchecks check `infra-reports` (sev:warning): its ping URL lives in the gitignored env file.
CONFIG="${INFRADRIFT_ENV:-$HOME/.config/infra-drift/env}"
if [ -f "$CONFIG" ]; then set -a; . "$CONFIG"; set +a; fi
HC_URL="${INFRADRIFT_REPORTS_HC_PING_URL:-}"

# launchd runs a missed 07:30 job when the Mac wakes, which can be the middle of the night.
if ! _in_send_hours; then
  log "outside send hours ($REPORT_SEND_FROM-$REPORT_SEND_UNTIL); digests left queued"
  exit 0
fi

load_alert_hub_tokens
send_queued_reports

# Healthy only when the queue is empty, so a missing token or a refused digest shows as down.
LEFT="$(queued_report_count)"
if [ -n "$HC_URL" ]; then
  if [ "$LEFT" -eq 0 ]; then
    curl -fsS --max-time 10 "$HC_URL" >/dev/null 2>&1 || log "WARN: HC success ping failed"
  else
    curl -fsS --max-time 10 --data-raw "$LEFT digest(s) still queued" "$HC_URL/fail" >/dev/null 2>&1 \
      || log "WARN: HC fail ping failed"
  fi
fi
[ "$LEFT" -eq 0 ]
