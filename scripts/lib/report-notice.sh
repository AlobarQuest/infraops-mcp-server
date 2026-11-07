#!/bin/bash
# Shared by drift-audit.sh, change-window.sh and send-reports.sh: send the daily reports to
# alert-hub as notices, held until the morning.
# Sourced, not executed. The caller defines log() and get_secret_by_id().

_REPORT_NOTICE_DIR="$(dirname "${BASH_SOURCE[0]}")"
# Overridable so the test can stub the helper.
ALERT_HUB_SEND="${ALERT_HUB_SEND:-$_REPORT_NOTICE_DIR/../alert-hub-send.sh}"
# The hub rejects a notice message over this many characters (UTF-16 code units, as the hub
# counts), and a request body over 16,384 bytes. The message is JSON-encoded in the body, where a
# newline costs 2 bytes and an emoji 4, so it is also held to this many encoded bytes.
REPORT_NOTICE_LIMIT=12000
REPORT_NOTICE_BYTE_LIMIT=15000

# Print <body-file> cut to fit both limits, ending with a footer that names <full-path>. A body
# within both limits is printed whole. Never splits a character.
_cut_report() {
  python3 - "$1" "$2" "$REPORT_NOTICE_LIMIT" "$REPORT_NOTICE_BYTE_LIMIT" <<'PY'
import json, sys
body_file, full_path = sys.argv[1], sys.argv[2]
limit, byte_limit = int(sys.argv[3]), int(sys.argv[4])
body = open(body_file, encoding="utf-8").read()
units = lambda s: len(s.encode("utf-16-le")) // 2
# Encoded size of the string literal, quotes included: the two quote bytes count against the cap.
size = lambda s: len(json.dumps(s, ensure_ascii=False).encode("utf-8"))
if units(body) <= limit and size(body) <= byte_limit:
    sys.stdout.write(body)
    sys.exit(0)
footer = f"\n\n… (cut at {limit:,} of {units(body):,} characters; full reports: {full_path} on the Mac mini)"
room_units, room_bytes = limit - units(footer), byte_limit - size(footer)
used_units, used_bytes, end = 0, 0, 0
for ch in body:
    cost_units, cost_bytes = units(ch), size(ch) - 2
    if used_units + cost_units > room_units or used_bytes + cost_bytes > room_bytes:
        break
    used_units, used_bytes, end = used_units + cost_units, used_bytes + cost_bytes, end + 1
sys.stdout.write(body[:end] + footer)
PY
}

# Export the alert-hub tokens from BWS by UUID: ALERT_HUB_TOKEN (urgent alerts, read by the CLIs)
# and ALERT_HUB_REPORT_TOKEN (the report notice). The UUIDs default inline and are overridable via
# BWS_ALERT_HUB_TOKEN_ID / BWS_ALERT_HUB_REPORT_TOKEN_ID. Needs the caller's get_secret_by_id;
# never echoes a token.
load_alert_hub_tokens() {
  export ALERT_HUB_TOKEN="$(get_secret_by_id "${BWS_ALERT_HUB_TOKEN_ID:-7a36a369-c649-4893-a768-b4ee00feb92a}")"
  export ALERT_HUB_REPORT_TOKEN="$(get_secret_by_id "${BWS_ALERT_HUB_REPORT_TOKEN_ID:-4ed74de3-09d4-408f-917a-b4ee00feba75}")"
}

# Succeeds only when the hub accepted the notice. The token reaches the helper through its
# environment, never argv.
_send_report_notice() { # _send_report_notice <key> <subject> <body-file> <full-path>
  local message
  message="$(_cut_report "$3" "$4")" || return 1
  ALERT_HUB_TOKEN="$ALERT_HUB_REPORT_TOKEN" \
    "$ALERT_HUB_SEND" --notice -- "$1" info "$2" "$message"
}

# Reports wait here between the night jobs and the morning send, one directory per report.
REPORT_OUTBOX="${REPORT_OUTBOX:-$HOME/infra-drift/outbox}"
# Reports go out from REPORT_SEND_FROM until REPORT_SEND_UNTIL (local HHMM), outside alert-hub's
# quiet hours. A night job that finishes inside that span sends at once instead of waiting a day.
REPORT_SEND_FROM="${REPORT_SEND_FROM:-0730}"
REPORT_SEND_UNTIL="${REPORT_SEND_UNTIL:-2000}"

_in_send_hours() {
  local now="${REPORT_NOW_HHMM:-$(date +%H%M)}"
  [[ ! "$now" < "$REPORT_SEND_FROM" && "$now" < "$REPORT_SEND_UNTIL" ]]
}

# queue_report <key> <subject> <body-file> <reports-dir-for-footer>
# Saves the report for the morning send, then sends the queue at once inside send hours.
# Best-effort and non-fatal: logs one WARN line on failure and always returns 0.
queue_report() {
  [ -f "$3" ] || return 0
  local tmp=""
  # Built beside the outbox and renamed in, so the sender never sees half a report.
  if mkdir -p "$REPORT_OUTBOX" && tmp="$(mktemp -d "$REPORT_OUTBOX/.new.XXXXXX")" \
    && printf '%s' "$1" > "$tmp/key" && printf '%s' "$2" > "$tmp/subject" \
    && printf '%s' "$4" > "$tmp/full_path" && cp "$3" "$tmp/body.md" \
    && mv "$tmp" "$REPORT_OUTBOX/$(date +%s).$$.${RANDOM}"; then
    log "digest queued ($1)"
  else
    [ -n "$tmp" ] && rm -rf "$tmp"
    log "WARN: could not queue the digest ($1); not sent"
    return 0
  fi
  if _in_send_hours; then send_queued_reports; fi
  return 0
}

# Counts the reports waiting to be sent.
queued_report_count() {
  find "$REPORT_OUTBOX" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*' 2>/dev/null | wc -l | tr -d ' '
}

# send_queued_reports: sends every queued report in the order queued, to the second, and deletes
# each one the hub accepts. A report that fails stays queued for the next send. Always returns 0.
send_queued_reports() {
  local dir claimed key
  if [ -z "${ALERT_HUB_REPORT_TOKEN:-}" ]; then
    [ "$(queued_report_count)" -eq 0 ] || log "WARN: no alert-hub report token; digests left queued"
    return 0
  fi
  for dir in "$REPORT_OUTBOX"/[0-9]*; do
    [ -d "$dir" ] || continue
    # A rename is atomic, so two overlapping sends can't both claim, and both send, one report.
    claimed="$REPORT_OUTBOX/.sending.$$.${dir##*/}"
    mv "$dir" "$claimed" 2>/dev/null || continue
    key="$(cat "$claimed/key")"
    if _send_report_notice "$key" "$(cat "$claimed/subject")" "$claimed/body.md" "$(cat "$claimed/full_path")"; then
      rm -rf "$claimed"
      log "digest sent to alert-hub ($key)"
    else
      mv "$claimed" "$dir"
      log "WARN: alert-hub notice failed; digest left queued ($key)"
    fi
  done
  return 0
}
