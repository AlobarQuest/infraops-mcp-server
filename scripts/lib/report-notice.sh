#!/bin/bash
# Shared by drift-audit.sh and change-window.sh: send a daily report to alert-hub as a notice.
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

# send_report <key> <subject> <body-file> <reports-dir-for-footer>
# Best-effort and non-fatal: logs one WARN line on failure and always returns 0.
send_report() {
  [ -f "$3" ] || return 0
  if [ -z "${ALERT_HUB_REPORT_TOKEN:-}" ]; then
    log "WARN: no alert-hub report token; digest not sent"
  elif _send_report_notice "$@"; then
    log "digest sent to alert-hub ($1)"
  else
    log "WARN: alert-hub notice failed; digest not sent"
  fi
  return 0
}
