#!/bin/bash
# Daily infrastructure standards drift audit — runs on the Mac mini via launchd
# (com.devon.infra-drift). Mirrors the vps-backup pattern.
#
# Secrets: sources a gitignored env file ($HOME/.config/infra-drift/env) for the
# bootstrap BWS_ACCESS_TOKEN + Healthchecks.io ping URL, then fetches every other
# secret from BWS *by name* (no UUIDs, no secrets in this public file). Runs the
# audit CLI (writes <date>.json + delta + <date>.md to the report dir), emails the
# markdown digest via Resend, and pings the Healthchecks.io dead-man's switch.
set -uo pipefail

# ── Config (overridable via the sourced env file) ──────────────────────────────
CONFIG="${INFRADRIFT_ENV:-$HOME/.config/infra-drift/env}"
if [ -f "$CONFIG" ]; then set -a; . "$CONFIG"; set +a; fi

REPO="${INFRADRIFT_REPO:-$HOME/Projects/infraops-mcp-server}"
REPORT_DIR="${INFRADRIFT_REPORT_DIR:-$HOME/infra-drift/reports}"
LOG_FILE="${INFRADRIFT_LOG:-$HOME/Library/Logs/infra-drift.log}"
EMAIL_TO="${INFRADRIFT_EMAIL_TO:-devon.watkins@gmail.com}"
EMAIL_FROM="${INFRADRIFT_EMAIL_FROM:-infra@devonwatkins.com}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

[ -n "${BWS_ACCESS_TOKEN:-}" ] || { log "FATAL: BWS_ACCESS_TOKEN not set (check $CONFIG)"; exit 1; }

# Fetch a BWS secret by its name (key), empty string if absent.
# The name is passed as argv to python3 (a `K=.. cmd | python3` prefix would only
# set K for the left side of the pipe, not the parser — which silently returns "").
get_secret() {
  bws secret list --output json 2>/dev/null \
    | python3 -c "import sys,json; k=sys.argv[1]; d=json.load(sys.stdin); print(next((s['value'] for s in d if s.get('key')==k), ''))" "$1" 2>/dev/null
}

log "──────── drift audit started ────────"

HC_URL="${INFRADRIFT_HC_PING_URL:-}"
[ -n "$HC_URL" ] && { curl -fsS --max-time 10 "$HC_URL/start" >/dev/null 2>&1 || log "WARN: HC /start ping failed"; }

# ── Coolify (prod via public domain, dev via mini-local OrbStack) ──────────────
export COOLIFY_BASE_URL="${COOLIFY_BASE_URL:-http://coolify-1.devonwatkins.com}"
export COOLIFY_API_TOKEN="$(get_secret prod-coolify-api-token)"
export COOLIFY_DEV_BASE_URL="${COOLIFY_DEV_BASE_URL:-http://192.168.139.217:8000}"
export COOLIFY_DEV_API_TOKEN="$(get_secret local-coolify-api)"

# ── infra-brain (live standards) ──────────────────────────────────────────────
export INFRABRAIN_BASE_URL="${INFRABRAIN_BASE_URL:-https://infra-brain.devonwatkins.com}"
export INFRABRAIN_ACCESS_KEY="$(get_secret INFRABRAIN_ACCESS_KEY)"

RESEND_API_KEY="$(get_secret resend-api-key)"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; DATE="${NOW%%T*}"
mkdir -p "$REPORT_DIR"

# ── Run the audit (exit 1 only if EVERY instance hard-failed) ──────────────────
node "$REPO/dist/cli/audit-cli.js" --instance prod,dev --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1
RC=$?
log "audit CLI exited rc=$RC"

JSON="$REPORT_DIR/$DATE.json"; MD="$REPORT_DIR/$DATE.md"

# ── Email digest via Resend (best-effort) ──────────────────────────────────────
if [ -n "$RESEND_API_KEY" ] && [ -f "$MD" ] && [ -f "$JSON" ]; then
  TOTAL=$(python3 -c "import json;print(json.load(open('$JSON'))['totals']['total_proposals'])" 2>/dev/null || echo '?')
  NEW=$(python3 -c "import json;print(len(json.load(open('$JSON'))['delta']['new']))" 2>/dev/null || echo '?')
  FAILED=$(python3 -c "import json;print(json.load(open('$JSON'))['totals']['instances_failed'])" 2>/dev/null || echo '0')
  SUBJECT="Infra drift $DATE — ${TOTAL} deviations (${NEW} new)"
  [ "$FAILED" != "0" ] && SUBJECT="$SUBJECT — ⚠ ${FAILED} instance(s) unreachable"
  # Build the JSON payload with python (safe escaping of the markdown body), send with
  # curl (the path proven to work against the Resend API).
  PAYLOAD_FILE="$(mktemp -t infra-drift-mail)"
  EMAIL_FROM="$EMAIL_FROM" EMAIL_TO="$EMAIL_TO" SUBJECT="$SUBJECT" MD="$MD" python3 - > "$PAYLOAD_FILE" <<'PY'
import os, json
print(json.dumps({"from": os.environ['EMAIL_FROM'], "to": [os.environ['EMAIL_TO']],
                  "subject": os.environ['SUBJECT'], "text": open(os.environ['MD']).read()}))
PY
  if curl -fsS --max-time 20 -X POST https://api.resend.com/emails \
       -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
       --data @"$PAYLOAD_FILE" >/dev/null 2>&1; then
    log "digest emailed to $EMAIL_TO"
  else
    log "WARN: digest email failed"
  fi
  rm -f "$PAYLOAD_FILE"
fi

# ── Heartbeat (Healthchecks.io dead-man's switch) ──────────────────────────────
if [ -n "$HC_URL" ]; then
  if [ "$RC" -eq 0 ]; then
    curl -fsS --max-time 10 "$HC_URL" >/dev/null 2>&1 || log "WARN: HC success ping failed"
  else
    curl -fsS --max-time 10 "$HC_URL/fail" >/dev/null 2>&1 || true
    log "pinged HC /fail (rc=$RC)"
  fi
fi

log "──────── drift audit done (rc=$RC) ────────"
exit "$RC"
