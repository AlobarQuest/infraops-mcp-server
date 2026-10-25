#!/bin/bash
# Shared by drift-audit.sh and change-window.sh: send a daily report to alert-hub as a notice,
# falling back to Resend. Sourced, not executed. The caller defines log() and EMAIL_FROM/EMAIL_TO,
# and exports RESEND_API_KEY and (optionally) ALERT_HUB_REPORT_TOKEN.

_REPORT_NOTICE_DIR="$(dirname "${BASH_SOURCE[0]}")"
# Overridable so the test can stub the helper.
ALERT_HUB_SEND="${ALERT_HUB_SEND:-$_REPORT_NOTICE_DIR/../alert-hub-send.sh}"
# The hub rejects a notice message over this many characters (UTF-16 code units, as the hub counts).
REPORT_NOTICE_LIMIT=12000

# Print <body-file> cut to REPORT_NOTICE_LIMIT characters, ending with a footer that names
# <full-path>. A body within the limit is printed whole. Counts characters, not bytes.
_cut_report() {
  python3 - "$1" "$2" "$REPORT_NOTICE_LIMIT" <<'PY'
import sys
body_file, full_path, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
body = open(body_file, encoding="utf-8").read()
units = lambda s: len(s.encode("utf-16-le")) // 2
total = units(body)
if total <= limit:
    sys.stdout.write(body)
    sys.exit(0)
footer = f"\n\n… (cut at {limit:,} of {total:,} characters; full report: {full_path} on the Mac mini)"
raw = body.encode("utf-16-le")[: (limit - units(footer)) * 2]
sys.stdout.write(raw.decode("utf-16-le", errors="ignore") + footer)
PY
}

# Succeeds only when the hub accepted the notice. The token reaches the helper through its
# environment, never argv.
_send_report_notice() { # _send_report_notice <key> <subject> <body-file> <full-path>
  local message
  message="$(_cut_report "$3" "$4")" || return 1
  ALERT_HUB_TOKEN="$ALERT_HUB_REPORT_TOKEN" \
    "$ALERT_HUB_SEND" --notice -- "$1" info "$2" "$message"
}

_send_report_resend() { # _send_report_resend <subject> <body-file>
  [ -n "${RESEND_API_KEY:-}" ] && [ -f "$2" ] || return 0
  # Build the JSON payload with python (safe escaping of the markdown body), send with
  # curl (the path proven to work against the Resend API).
  local payload_file
  payload_file="$(mktemp -t report-mail)"
  EMAIL_FROM="$EMAIL_FROM" EMAIL_TO="$EMAIL_TO" SUBJECT="$1" MD="$2" python3 - > "$payload_file" <<'PY'
import os, json
print(json.dumps({"from": os.environ['EMAIL_FROM'], "to": [os.environ['EMAIL_TO']],
                  "subject": os.environ['SUBJECT'], "text": open(os.environ['MD']).read()}))
PY
  if curl -fsS --max-time 20 -X POST https://api.resend.com/emails \
       -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
       --data @"$payload_file" >/dev/null 2>&1; then
    log "digest emailed to $EMAIL_TO"
  else
    log "WARN: digest email failed"
  fi
  rm -f "$payload_file"
}

# send_report <key> <subject> <body-file> <full-path-for-footer>
# Best-effort and non-fatal: always returns 0.
send_report() {
  [ -f "$3" ] || return 0
  if [ -n "${ALERT_HUB_REPORT_TOKEN:-}" ]; then
    if _send_report_notice "$@"; then
      log "digest sent to alert-hub ($1)"
      return 0
    fi
    log "WARN: alert-hub notice failed; falling back to Resend"
  fi
  _send_report_resend "$2" "$3"
}
