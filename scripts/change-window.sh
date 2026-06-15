#!/bin/bash
# Daily change-window executor — runs on the Mac mini via launchd
# (com.devon.change-window) at 04:00. Mirrors the drift-audit pattern.
#
# Secrets: sources a gitignored env file ($HOME/.config/infra-drift/env) for the
# bootstrap BWS_ACCESS_TOKEN + Healthchecks.io ping URL (INFRADRIFT_CW_HC_PING_URL),
# then fetches every other secret from BWS *by stable UUID* (per infra-brain lesson
# #277 — no secrets in this public file; UUIDs defaulted inline, overridable via
# BWS_*_SECRET_ID). Runs the change-mgr run-window CLI (executes approved change
# requests, writes <date>.change-window.md digest to the report dir), emails the
# digest via Resend, and pings the Healthchecks.io dead-man's switch.
set -uo pipefail

# ── Config (overridable via the sourced env file) ──────────────────────────────
CONFIG="${INFRADRIFT_ENV:-$HOME/.config/infra-drift/env}"
if [ -f "$CONFIG" ]; then set -a; . "$CONFIG"; set +a; fi

REPO="${INFRADRIFT_REPO:-$HOME/Projects/infraops-mcp-server}"
REPORT_DIR="${INFRADRIFT_REPORT_DIR:-$HOME/infra-drift/reports}"
LOG_FILE="${INFRADRIFT_CW_LOG:-$HOME/Library/Logs/change-window.log}"
EMAIL_TO="${INFRADRIFT_EMAIL_TO:-devon.watkins@gmail.com}"
EMAIL_FROM="${INFRADRIFT_EMAIL_FROM:-infra@devonwatkins.com}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

[ -n "${BWS_ACCESS_TOKEN:-}" ] || { log "FATAL: BWS_ACCESS_TOKEN not set (check $CONFIG)"; exit 1; }

# Fetch a BWS secret by its immutable UUID (per infra-brain lesson #277 — names are
# mutable, UUIDs are stable). Mirrors start.sh. Empty string if absent. Every secret
# is referenced by UUID (defaulted inline, overridable via BWS_*_SECRET_ID).
get_secret_by_id() {
  bws secret get "$1" --output json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])" 2>/dev/null || echo ""
}

log "──────── change-window started ────────"

HC_URL="${INFRADRIFT_CW_HC_PING_URL:-}"
[ -n "$HC_URL" ] && { curl -fsS --max-time 10 "$HC_URL/start" >/dev/null 2>&1 || log "WARN: HC /start ping failed"; }

# ── Coolify (prod via public domain, dev via mini-local OrbStack) ──────────────
export COOLIFY_BASE_URL="${COOLIFY_BASE_URL:-http://coolify-1.devonwatkins.com}"
export COOLIFY_API_TOKEN="$(get_secret_by_id "${BWS_PROD_COOLIFY_SECRET_ID:-bbd71f41-b7df-4ae9-8fdb-b41501447308}")"
export COOLIFY_DEV_BASE_URL="${COOLIFY_DEV_BASE_URL:-http://192.168.139.217:8000}"
export COOLIFY_DEV_API_TOKEN="$(get_secret_by_id "${BWS_DEV_COOLIFY_SECRET_ID:-8a2e1e10-d67b-4382-bbf3-b4150178e2a8}")"

RESEND_API_KEY="$(get_secret_by_id "${BWS_RESEND_SECRET_ID:-56f06eba-925a-4d8e-bfe8-b415015ab8ef}")"
# Anthropic key for change execution plan generation — fetched by stable UUID,
# overridable via BWS_ANTHROPIC_SECRET_ID.
export ANTHROPIC_API_KEY="$(get_secret_by_id "${BWS_ANTHROPIC_SECRET_ID:-b74bf8b3-938b-45c0-bc25-b415013cb563}")"

# ── Change Manager M2M token ──────────────────────────────────────────────────
export CHANGE_MGR_API_BASE="${CHANGE_MGR_API_BASE:-https://change-mgr.alobar.net}"
export CHANGE_MGR_M2M_TOKEN="$(get_secret_by_id "${BWS_CHANGE_MGR_M2M_SECRET_ID:-af0e4192-edc6-46ae-9e4f-b469011dbb8d}")"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; DATE="${NOW%%T*}"
mkdir -p "$REPORT_DIR"

# ── Run the change window executor ────────────────────────────────────────────
node "$REPO/dist/cli/change-mgr-cli.js" run-window --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1
RC=$?
log "change-mgr run-window exited rc=$RC"

# ── Run the verbatim security executor (approved security items only) ───────────
# Deterministic, no LLM; integrity-gated. Best-effort/non-fatal — never blocks the
# Coolify window result. Reuses the same CM M2M token exported above.
node "$REPO/dist/cli/change-mgr-cli.js" run-security-window --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1 \
  && log "change-mgr run-security-window ok" \
  || log "WARN: change-mgr run-security-window failed (non-fatal)"

CW_MD="$REPORT_DIR/$DATE.change-window.md"
SUBJECT="Change window $DATE"

# ── Email digest via Resend (best-effort) ──────────────────────────────────────
if [ -n "$RESEND_API_KEY" ] && [ -f "$CW_MD" ]; then
  # Build the JSON payload with python (safe escaping of the markdown body), send with
  # curl (the path proven to work against the Resend API).
  PAYLOAD_FILE="$(mktemp -t change-window-mail)"
  EMAIL_FROM="$EMAIL_FROM" EMAIL_TO="$EMAIL_TO" SUBJECT="$SUBJECT" MD="$CW_MD" python3 - > "$PAYLOAD_FILE" <<'PY'
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
    log "pinged HC /fail (run-window rc=$RC)"
  fi
fi

log "──────── change-window done (rc=$RC) ────────"
exit $RC
