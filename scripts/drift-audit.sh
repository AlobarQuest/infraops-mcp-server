#!/bin/bash
# Daily infrastructure standards drift audit + remediation pass — runs on the Mac
# mini via launchd (com.devon.infra-drift) at 03:00. Mirrors the vps-backup pattern.
#
# Secrets: the bootstrap BWS_ACCESS_TOKEN is loaded from the macOS login Keychain
# (service 'Claude', account 'BWS_ACCESS_TOKEN_INFRA_DRIFT' — see bws-token.sh), never
# from a plaintext file. The gitignored env file ($HOME/.config/infra-drift/env) now
# carries only the Healthchecks.io ping URL. Every other secret is fetched from BWS
# *by stable UUID* (per infra-brain lesson #277 — no secrets in this
# public file; UUIDs defaulted inline, overridable via BWS_*_SECRET_ID). Runs the
# audit CLI (writes <date>.json + delta + <date>.md to the report dir), then the
# remediation CLI (auto-applies safe fixes, plans caution/destructive/question items,
# writes <date>.remediation.json + <date>.remediation.md), emails the consolidated
# digest via Resend, and pings the Healthchecks.io dead-man's switch.
set -uo pipefail

# ── Config (overridable via the sourced env file) ──────────────────────────────
CONFIG="${INFRADRIFT_ENV:-$HOME/.config/infra-drift/env}"
if [ -f "$CONFIG" ]; then set -a; . "$CONFIG"; set +a; fi

# Bootstrap BWS token from the login Keychain (not the env file). Idempotent.
source "$(dirname "${BASH_SOURCE[0]}")/bws-token.sh"

REPO="${INFRADRIFT_REPO:-$HOME/Projects/infraops-mcp-server}"
# ACTIVATION — a merged change is not live on this machine until the code is pulled. The estate's
# Dependabot cascade stops at the merge, which is complete for a repository whose landing redeploys
# a hosted application and incomplete for this one, whose code runs from a working copy here
# (orchestrator ADR-0031). Best-effort by construction: the helper prints one `[activation]` line
# and returns 0 whatever it finds, so this job is never gated on being able to update itself. It
# re-execs this script when HEAD moves, because bash reads a script incrementally by byte offset
# and the file it just rewrote is this one.
_SDS_ACTIVATE="$HOME/.claude/bin/activate-checkout.sh"
if [ -r "$_SDS_ACTIVATE" ]; then
    # shellcheck source=/dev/null
    . "$_SDS_ACTIVATE"
else
    activate_checkout() {
        echo "[activation] helper missing at $HOME/.claude/bin/activate-checkout.sh —" \
             "this run is not activated"
    }
fi
activate_checkout "$REPO" "$0" "$@"

REPORT_DIR="${INFRADRIFT_REPORT_DIR:-$HOME/infra-drift/reports}"
LOG_FILE="${INFRADRIFT_LOG:-$HOME/Library/Logs/infra-drift.log}"
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

log "──────── drift audit started ────────"

HC_URL="${INFRADRIFT_HC_PING_URL:-}"
[ -n "$HC_URL" ] && { curl -fsS --max-time 10 "$HC_URL/start" >/dev/null 2>&1 || log "WARN: HC /start ping failed"; }

# ── Coolify (prod via public domain, dev via mini-local OrbStack) ──────────────
export COOLIFY_BASE_URL="${COOLIFY_BASE_URL:-http://coolify-1.devonwatkins.com}"
export COOLIFY_API_TOKEN="$(get_secret_by_id "${BWS_PROD_COOLIFY_SECRET_ID:-bbd71f41-b7df-4ae9-8fdb-b41501447308}")"
export COOLIFY_DEV_BASE_URL="${COOLIFY_DEV_BASE_URL:-http://192.168.139.217:8000}"
export COOLIFY_DEV_API_TOKEN="$(get_secret_by_id "${BWS_DEV_COOLIFY_SECRET_ID:-8a2e1e10-d67b-4382-bbf3-b4150178e2a8}")"

# ── infra-brain (live standards) ──────────────────────────────────────────────
export INFRABRAIN_BASE_URL="${INFRABRAIN_BASE_URL:-https://infra-brain.devonwatkins.com}"
export INFRABRAIN_ACCESS_KEY="$(get_secret_by_id "${BWS_INFRABRAIN_SECRET_ID:-45eb083f-4b05-4251-924d-b46700e5a643}")"

# ── app-brain (repo+branch resolution for app-conformance handoffs) ─────────────
# app-brain has its OWN MCP_ACCESS_KEY, distinct from infra-brain's (verified 2026-06-26:
# infra-brain's key 401s against app-brain). Its BWS secret UUID is the default below,
# overridable via BWS_APPBRAIN_SECRET_ID.
export APPBRAIN_BASE_URL="${APPBRAIN_BASE_URL:-https://app-brain.devonwatkins.com}"
export APPBRAIN_ACCESS_KEY="$(get_secret_by_id "${BWS_APPBRAIN_SECRET_ID:-68733abe-682a-4597-b88f-b4750189a56a}")"

RESEND_API_KEY="$(get_secret_by_id "${BWS_RESEND_SECRET_ID:-56f06eba-925a-4d8e-bfe8-b415015ab8ef}")"
# Anthropic key for remediation plan generation — fetched by stable UUID (BWS key
# name "anthropic-api-key"), overridable via BWS_ANTHROPIC_SECRET_ID.
export ANTHROPIC_API_KEY="$(get_secret_by_id "${BWS_ANTHROPIC_SECRET_ID:-b74bf8b3-938b-45c0-bc25-b415013cb563}")"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; DATE="${NOW%%T*}"
mkdir -p "$REPORT_DIR"

# ── Refresh app-brain from live Coolify BEFORE the compare (best-effort, non-fatal) ─
# Keeps the data the remediation handoff's repo+branch resolver reads current. Runs
# the already-merged idempotent brain sync over a localhost-only ssh -L into the
# brain-app-db container (reuses the existing Hetzner key — no new exposure). Dry-run
# by default; set APPBRAIN_SYNC_APPLY=1 in $CONFIG to write. BWS_ACCESS_TOKEN (exported
# above) is inherited for the script's Coolify-token fetch.
if bash "$REPO/scripts/appbrain-sync.sh" >>"$LOG_FILE" 2>&1; then
  log "app-brain sync ok"
else
  log "WARN: app-brain sync failed (non-fatal)"
fi

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

# ── Best-effort: push the day's escalations to the change manager (non-fatal) ────
export CHANGE_MGR_API_BASE="${CHANGE_MGR_API_BASE:-https://change-mgr.alobar.net}"
export CHANGE_MGR_M2M_TOKEN="$(get_secret_by_id "${BWS_CHANGE_MGR_M2M_SECRET_ID:-af0e4192-edc6-46ae-9e4f-b469011dbb8d}")"
if node "$REPO/dist/cli/change-mgr-cli.js" sync --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1; then
  log "change-mgr sync ok"
else
  log "WARN: change-mgr sync failed (non-fatal)"
fi

# ── Best-effort: the day's digest → orchestrator observations (non-fatal) ───────
# WS-P3.0. Posts one observation per audited Coolify instance to the orchestrator's
# observation spine. Deliberately outside RC/RC_REMEDIATE: the drift loop is never
# hostage to the orchestrator being reachable, but a failure is always logged, never
# silent.
export ORCHESTRATOR_API_BASE="${ORCHESTRATOR_API_BASE:-https://sds.alobar.net}"
export ORCHESTRATOR_M2M_TOKEN="$(get_secret_by_id "${BWS_ORCHESTRATOR_OBS_SECRET_ID:-8998c4ea-453c-4ae1-9b5c-b49500b8dacc}")"
export ORCHESTRATOR_CREDENTIAL_KEY_ID="${ORCHESTRATOR_CREDENTIAL_KEY_ID:-orchestrator-drift-reporter}"
if node "$REPO/dist/cli/orchestrator-cli.js" observe --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1; then
  log "orchestrator observation ok"
else
  log "WARN: orchestrator observation failed (non-fatal)"
fi

# ── Best-effort: run one follow-up minting pass (non-fatal) ────────────────────
# WS-P2.8. Mints the work units whose package-declared follow-up reviews have come due. Uses the
# orchestrator-system credential, NOT the drift-reporter one above: that identity is
# observe-and-propose, and minting is canonical mutation attributed to an agent_id forever.
# Deliberately outside RC/RC_REMEDIATE, like the observation step: the drift loop is never
# hostage to the orchestrator being reachable, but a failure is always logged, never silent.
#
# This one secret is fetched with a DIFFERENT BWS identity from every other secret in this
# script. The orchestrator SYSTEM bearer moved into the `SDS Operator` project on 2026-07-30
# and is readable only by the read-only `sds-operator` machine account (Keychain account
# BWS_ACCESS_TOKEN_SDS); the BWS_ACCESS_TOKEN_INFRA_DRIFT identity this script bootstraps with
# can no longer read it. Overriding inside the command substitution keeps the override local:
# every later get_secret_by_id call still uses the drift identity, including the
# drift-reporter observation secret above.
#
# Failing to override does not surface as an error: get_secret_by_id swallows failures and
# returns "", so the mint step would run with an empty bearer, 401, and log a non-fatal WARN.
export ORCHESTRATOR_MINT_TOKEN="$(
  BWS_ACCESS_TOKEN="$(/usr/bin/security find-generic-password \
      -s 'Claude' -a 'BWS_ACCESS_TOKEN_SDS' -w 2>/dev/null)"
  export BWS_ACCESS_TOKEN
  get_secret_by_id "${BWS_ORCHESTRATOR_SYSTEM_SECRET_ID:-221a48d5-3f29-4898-b300-b4820140c880}"
)"
export ORCHESTRATOR_MINT_CREDENTIAL_KEY_ID="${ORCHESTRATOR_MINT_CREDENTIAL_KEY_ID:-orchestrator-system}"
if node "$REPO/dist/cli/orchestrator-cli.js" mint-follow-ups >>"$LOG_FILE" 2>&1; then
  log "follow-up mint ok"
else
  log "WARN: follow-up mint failed (non-fatal)"
fi

# ── Best-effort: machine security-posture drift → change manager (non-fatal) ─────
# Runs security-scan.sh, auto-fixes the narrow set (guarded chmod), posts the rest
# to the CM (source=security), and emails NEW urgent items immediately. Reuses the
# CM token exported above; passes the Resend creds for the urgent-email path.
if RESEND_API_KEY="$RESEND_API_KEY" INFRADRIFT_EMAIL_TO="$EMAIL_TO" INFRADRIFT_EMAIL_FROM="$EMAIL_FROM" \
  node "$REPO/dist/cli/security-drift-cli.js" run --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1; then
  log "security-drift run ok"
else
  log "WARN: security-drift run failed (non-fatal)"
fi

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

# Append the security-drift digest to the email body if present.
SEC_MD="$REPORT_DIR/$DATE.security.md"
if [ -f "$SEC_MD" ] && [ -f "$BODY_MD" ]; then
  COMBINED="$(mktemp -t infra-drift-body)"
  { cat "$BODY_MD"; printf '\n\n---\n\n'; cat "$SEC_MD"; } > "$COMBINED" 2>/dev/null && BODY_MD="$COMBINED"
fi

# Prepend a deep link to the pending-review dashboard so the digest is actionable
# — one click from the morning email to the approve queue. Best-effort: on any
# failure BODY_MD is left unchanged and the digest still sends.
if [ -f "$BODY_MD" ]; then
  LINKED_BODY="$(mktemp -t infra-drift-linked)"
  { printf '👉 Review & approve pending items: %s/?status=pending\n\n' "$CHANGE_MGR_API_BASE"; cat "$BODY_MD"; } > "$LINKED_BODY" 2>/dev/null && BODY_MD="$LINKED_BODY"
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
