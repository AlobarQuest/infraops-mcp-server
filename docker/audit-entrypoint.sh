#!/usr/bin/env bash
#
# Headless drift-audit entrypoint (cron-invoked via `docker run`).
#
# Bootstrap secret: BWS_ACCESS_TOKEN (a scoped machine token). Every other secret is
# fetched from BWS *by name* — no UUIDs in source, same pattern as the MCP start.sh.
# Reaches Coolify over the host network (run the container with --network host):
# prod at localhost:8000, dev at the mini's tailnet IP.
#
# Flow: fetch secrets -> run audit (writes JSON + delta + markdown to /reports) ->
# email the markdown digest via Resend (best-effort) -> ping Healthchecks.io.
# The heartbeat is pinged ONLY on a successful audit, so a broken run trips the
# dead-man's switch; a hard failure pings the /fail endpoint for an immediate alert.
set -uo pipefail

REPORT_DIR="${REPORT_DIR:-/reports}"
INSTANCES="${INSTANCES:-prod,dev}"

fetch_bws_secret_by_name() {
  local name="$1"
  [ -z "$name" ] && { echo ""; return; }
  bws secret list --output json 2>/dev/null | jq -r --arg k "$name" '.[] | select(.key==$k) | .value' | head -n1
}

if [ -z "${BWS_ACCESS_TOKEN:-}" ]; then
  echo "FATAL: BWS_ACCESS_TOKEN not set — cannot fetch secrets" >&2
  exit 1
fi

# ── Coolify (host networking) ───────────────────────────────────────────────
export COOLIFY_BASE_URL="${COOLIFY_BASE_URL:-http://localhost:8000}"
export COOLIFY_API_TOKEN="$(fetch_bws_secret_by_name prod-coolify-api-token)"
export COOLIFY_DEV_BASE_URL="${COOLIFY_DEV_BASE_URL:-http://100.113.86.21:8000}"
export COOLIFY_DEV_API_TOKEN="$(fetch_bws_secret_by_name local-coolify-api)"

# ── infra-brain (live standards) ────────────────────────────────────────────
export INFRABRAIN_BASE_URL="${INFRABRAIN_BASE_URL:-https://infra-brain.devonwatkins.com}"
export INFRABRAIN_ACCESS_KEY="$(fetch_bws_secret_by_name INFRABRAIN_ACCESS_KEY)"

# ── Delivery (email + heartbeat) ────────────────────────────────────────────
RESEND_API_KEY="$(fetch_bws_secret_by_name resend-api-key)"
HC_PING_URL="$(fetch_bws_secret_by_name "${HC_SECRET_NAME:-infra/HEALTHCHECKS_DRIFT_URL}")"
EMAIL_TO="${INFRADRIFT_EMAIL_TO:-devon.watkins@gmail.com}"
EMAIL_FROM="${INFRADRIFT_EMAIL_FROM:-infra@devonwatkins.com}"

NOW="$(date -u +%FT%TZ)"
DATE="${NOW:0:10}"
mkdir -p "$REPORT_DIR"

# ── Run the audit (exit 1 only if EVERY instance hard-failed) ───────────────
node /app/dist/cli/audit-cli.js --instance "$INSTANCES" --report-dir "$REPORT_DIR" --now "$NOW"
AUDIT_RC=$?

JSON_FILE="$REPORT_DIR/$DATE.json"
MD_FILE="$REPORT_DIR/$DATE.md"

# ── Email digest via Resend (best-effort; never fails the run) ──────────────
if [ -n "$RESEND_API_KEY" ] && [ -f "$MD_FILE" ]; then
  TOTAL=$(jq -r '.totals.total_proposals // 0' "$JSON_FILE" 2>/dev/null || echo "?")
  NEW=$(jq -r '(.delta.new | length) // 0' "$JSON_FILE" 2>/dev/null || echo "?")
  FAILED=$(jq -r '.totals.instances_failed // 0' "$JSON_FILE" 2>/dev/null || echo "0")
  SUBJECT="Infra drift $DATE — ${TOTAL} deviations (${NEW} new)"
  [ "$FAILED" != "0" ] && SUBJECT="$SUBJECT — ⚠ ${FAILED} instance(s) unreachable"
  PAYLOAD=$(jq -n --arg from "$EMAIL_FROM" --arg to "$EMAIL_TO" --arg subject "$SUBJECT" --rawfile body "$MD_FILE" \
    '{from:$from, to:[$to], subject:$subject, text:$body}')
  if curl -fsS -m 20 -X POST https://api.resend.com/emails \
       -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
       -d "$PAYLOAD" >/dev/null 2>&1; then
    echo "digest emailed to $EMAIL_TO" >&2
  else
    echo "WARN: digest email failed" >&2
  fi
fi

# ── Heartbeat (Healthchecks.io dead-man's switch) ───────────────────────────
if [ -n "$HC_PING_URL" ]; then
  if [ "$AUDIT_RC" -eq 0 ]; then
    curl -fsS -m 10 "$HC_PING_URL" >/dev/null 2>&1 && echo "heartbeat ok" >&2 || echo "WARN: heartbeat ping failed" >&2
  else
    curl -fsS -m 10 "${HC_PING_URL%/}/fail" >/dev/null 2>&1 || true
    echo "audit failed (rc=$AUDIT_RC) — pinged /fail" >&2
  fi
fi

exit "$AUDIT_RC"
