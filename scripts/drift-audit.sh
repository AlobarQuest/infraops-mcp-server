#!/bin/bash
# Daily infrastructure standards drift audit + remediation pass — runs on the Mac
# mini via launchd (com.devon.infra-drift) at 03:00. Mirrors the vps-backup pattern.
#
# Secrets: sources a gitignored env file ($HOME/.config/infra-drift/env) for the
# bootstrap BWS_ACCESS_TOKEN + Healthchecks.io ping URL, then fetches every other
# secret from BWS *by name* (no UUIDs, no secrets in this public file). Runs the
# audit CLI (writes <date>.json + delta + <date>.md to the report dir), then the
# remediation CLI (auto-applies safe fixes, plans caution/destructive/question items,
# writes <date>.remediation.json + <date>.remediation.md), emails the consolidated
# digest via Resend, and pings the Healthchecks.io dead-man's switch.
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

# Fetch a BWS secret by its immutable UUID (per infra-brain lesson #277 — names are
# mutable, UUIDs are stable). Mirrors start.sh. Empty string if absent.
get_secret_by_id() {
  bws secret get "$1" --output json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])" 2>/dev/null || echo ""
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
# Anthropic key for remediation plan generation — fetched by stable UUID (BWS key
# name "anthropic-api-key"), overridable via BWS_ANTHROPIC_SECRET_ID.
export ANTHROPIC_API_KEY="$(get_secret_by_id "${BWS_ANTHROPIC_SECRET_ID:-b74bf8b3-938b-45c0-bc25-b415013cb563}")"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; DATE="${NOW%%T*}"
mkdir -p "$REPORT_DIR"

# ── Run the audit (exit 1 only if EVERY instance hard-failed) ──────────────────
node "$REPO/dist/cli/audit-cli.js" --instance prod,dev --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1
RC=$?
log "audit CLI exited rc=$RC"

JSON="$REPORT_DIR/$DATE.json"; MD="$REPORT_DIR/$DATE.md"

# ── Remediate: auto-apply safe fixes, package the rest (best-effort) ────────────
REMEDIATE_MD="$REPORT_DIR/$DATE.remediation.md"
node "$REPO/dist/cli/remediate-cli.js" --instance prod,dev --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1
RC_REMEDIATE=$?
log "remediate CLI exited rc=$RC_REMEDIATE"

# Prefer the consolidated remediation digest; fall back to the raw audit digest.
if [ -f "$REMEDIATE_MD" ]; then
  BODY_MD="$REMEDIATE_MD"
  APPLIED=$(python3 -c "import json;print(json.load(open('$REPORT_DIR/$DATE.remediation.json'))['totals']['applied'])" 2>/dev/null || echo '?')
  ESCALATED=$(python3 -c "import json;print(json.load(open('$REPORT_DIR/$DATE.remediation.json'))['totals']['escalated'])" 2>/dev/null || echo '?')
  SUBJECT="Infra remediation $DATE — ${APPLIED} fixed, ${ESCALATED} need you"
else
  BODY_MD="$MD"
  SUBJECT="Infra drift $DATE — audit only (remediation step failed)"
fi

# ── Email digest via Resend (best-effort) ──────────────────────────────────────
if [ -n "$RESEND_API_KEY" ] && [ -f "$BODY_MD" ]; then
  # Build the JSON payload with python (safe escaping of the markdown body), send with
  # curl (the path proven to work against the Resend API).
  PAYLOAD_FILE="$(mktemp -t infra-drift-mail)"
  EMAIL_FROM="$EMAIL_FROM" EMAIL_TO="$EMAIL_TO" SUBJECT="$SUBJECT" MD="$BODY_MD" python3 - > "$PAYLOAD_FILE" <<'PY'
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
  if [ "$RC" -eq 0 ] && [ "$RC_REMEDIATE" -eq 0 ]; then
    curl -fsS --max-time 10 "$HC_URL" >/dev/null 2>&1 || log "WARN: HC success ping failed"
  else
    curl -fsS --max-time 10 "$HC_URL/fail" >/dev/null 2>&1 || true
    log "pinged HC /fail (audit rc=$RC remediate rc=$RC_REMEDIATE)"
  fi
fi

log "──────── drift audit + remediate done (audit rc=$RC remediate rc=$RC_REMEDIATE) ────────"
[ "$RC" -eq 0 ] && [ "$RC_REMEDIATE" -eq 0 ] && exit 0 || exit 1
