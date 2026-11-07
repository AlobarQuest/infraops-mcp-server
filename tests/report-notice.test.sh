#!/bin/bash
# shellcheck disable=SC2317  # the stubs below are called indirectly by the sourced report-notice.sh
# Tests for scripts/lib/report-notice.sh. Stubs curl (on PATH) and alert-hub-send.sh.
# Run: bash tests/report-notice.test.sh
# shellcheck disable=SC2329 # helpers run indirectly through check(), and log() from the sourced lib
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILED=0

mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'STUB'
#!/bin/bash
printf '%s\n' "$*" >> "$STUB_DIR/curl.args"
STUB
cat > "$WORK/hub-send" <<'STUB'
#!/bin/bash
printf '%s\0' "$@" > "$STUB_DIR/hub.args"
printf '%s' "${ALERT_HUB_TOKEN:-}" > "$STUB_DIR/hub.token"
exit "${STUB_HUB_RC:-0}"
STUB
chmod +x "$WORK/bin/curl" "$WORK/hub-send"

log() { echo "$*" >> "$WORK/log"; }
export STUB_DIR="$WORK" ALERT_HUB_SEND="$WORK/hub-send" PATH="$WORK/bin:$PATH" REPORT_OUTBOX="$WORK/outbox"
# shellcheck source=../scripts/lib/report-notice.sh
. "$ROOT/scripts/lib/report-notice.sh"
# Inside send hours a queued report goes out at once, so these cases cover the cut and the send.
send_report() { REPORT_NOW_HHMM=0900 queue_report "$@"; }

units() { python3 -c 'import sys; print(len(sys.stdin.read().encode("utf-16-le")) // 2)'; }

check() { # check <name> <command...>
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; FAILED=1; fi
}

reset() { rm -rf "$WORK"/{curl.args,hub.args,hub.token,log,outbox}; unset STUB_HUB_RC; }
queued() { queued_report_count; }
# Fields of the recorded helper call, one per line: --notice, --, key, severity, subject, message.
hub_field() { tr '\0' '\n' < "$WORK/hub.args" | sed -n "${1}p"; }
hub_message() { python3 -c 'import sys; print(sys.stdin.buffer.read().split(b"\0")[5].decode(), end="")' < "$WORK/hub.args"; }
hub_called() { [ -s "$WORK/hub.args" ]; }
not_in_argv() { ! tr '\0' '\n' < "$WORK/hub.args" | grep -q "$1"; }
not_in_log() { ! grep -q "$1" "$WORK/log" 2>/dev/null; }
absent() { [ ! -e "$1" ]; }
logged_warn() { grep -q '^WARN' "$WORK/log" 2>/dev/null; }

# make_body <n>: n repetitions of "a" + one emoji, which is 3 UTF-16 units each.
make_body() { python3 -c "import sys; sys.stdout.write('a😀' * int(sys.argv[1]))" "$1" > "$WORK/body.md"; }
eq() { [ "$1" = "$2" ]; }

# --- hub path: a long body with emoji is cut to 12,000 characters with the footer ----------------
reset; make_body 10000
ALERT_HUB_REPORT_TOKEN=report-token \
  send_report "report:infra-drift:2026-10-25" "Subject" "$WORK/body.md" "/reports"
msg="$(hub_message)"
check "long body: sent as a notice with key, info, subject" \
  eq "$(hub_field 1)|$(hub_field 3)|$(hub_field 4)|$(hub_field 5)" \
  "--notice|report:infra-drift:2026-10-25|info|Subject"
check "long body: at most 12000 characters" test "$(printf '%s' "$msg" | units)" -le 12000
check "long body: ends with the footer" \
  eq "${msg##*$'\n\n'}" "… (cut at 12,000 of 30,000 characters; full reports: /reports on the Mac mini)"
check "long body: token reaches the helper by environment only" \
  eq "$(cat "$WORK/hub.token")" report-token
check "long body: token is not in argv" not_in_argv report-token

# --- hub path: a cut message fits the hub's 12,000-character AND 16 KB request-body limits ----
# Reads the recorded message from a file, so trailing newlines survive.
sent_within_limits() { # <=12000 UTF-16 units and <=15000 JSON-encoded UTF-8 bytes
  python3 - "$WORK/hub.args" <<'PY'
import json, sys
msg = open(sys.argv[1], "rb").read().split(b"\0")[5].decode()
units = len(msg.encode("utf-16-le")) // 2
size = len(json.dumps(msg, ensure_ascii=False).encode("utf-8"))
sys.exit(0 if units <= 12000 and size <= 15000 else 1)
PY
}
reset; python3 -c "import sys; sys.stdout.write('\n' * 12000 + 'tail')" > "$WORK/body.md"
ALERT_HUB_REPORT_TOKEN=report-token send_report "k" "S" "$WORK/body.md" "/reports"
check "12000 newlines: cut within both limits" sent_within_limits
reset; make_body 4000
ALERT_HUB_REPORT_TOKEN=report-token send_report "k" "S" "$WORK/body.md" "/reports"
check "emoji body of 12000 units: cut within both limits" sent_within_limits

# --- hub path: a short body goes whole ------------------------------------------------------------
reset; printf 'short report 😀\n' > "$WORK/body.md"
ALERT_HUB_REPORT_TOKEN=report-token send_report "k" "S" "$WORK/body.md" "/x.md"
check "short body: sent whole" eq "$(hub_message)" "$(cat "$WORK/body.md")"

# --- hub path: a body of exactly 12000 characters goes whole ----------------------------------
reset; python3 -c "import sys; sys.stdout.write('a' * 12000)" > "$WORK/body.md"
ALERT_HUB_REPORT_TOKEN=report-token send_report "k" "S" "$WORK/body.md" "/x.md"
check "boundary body: sent whole" eq "$(hub_message)" "$(cat "$WORK/body.md")"

# --- no hub token: nothing is sent, one WARN line, and the run goes on ----------------------------
reset; printf 'short\n' > "$WORK/body.md"
ALERT_HUB_REPORT_TOKEN='' send_report "k" "S" "$WORK/body.md" "/x.md"; rc=$?
check "no token: hub not called" absent "$WORK/hub.args"
check "no token: nothing else is sent" absent "$WORK/curl.args"
check "no token: WARN logged" logged_warn
check "no token: non-fatal" eq "$rc" 0

# --- hub failure: one WARN line, nothing else is sent, and the run goes on ------------------------
reset; printf 'short\n' > "$WORK/body.md"
STUB_HUB_RC=1 ALERT_HUB_REPORT_TOKEN=report-token send_report "k" "S" "$WORK/body.md" "/x.md"; rc=$?
check "hub failure: hub tried" hub_called
check "hub failure: nothing else is sent" absent "$WORK/curl.args"
check "hub failure: WARN logged" logged_warn
check "hub failure: token not logged" not_in_log report-token
check "hub failure: non-fatal" eq "$rc" 0

# --- missing body: nothing is sent -----------------------------------------------------------------
reset
ALERT_HUB_REPORT_TOKEN=report-token send_report "k" "S" "$WORK/absent.md" "/x.md"
check "missing body: hub not called" absent "$WORK/hub.args"
check "missing body: nothing else is sent" absent "$WORK/curl.args"

# --- night: a report queued outside send hours waits for the morning send -----------------------
reset; printf 'night report\n' > "$WORK/body.md"
REPORT_NOW_HHMM=0300 ALERT_HUB_REPORT_TOKEN=report-token \
  queue_report "report:infra-drift:2026-11-07" "Night" "$WORK/body.md" "/reports"; rc=$?
check "night: hub not called" absent "$WORK/hub.args"
check "night: one report queued" eq "$(queued)" 1
check "night: non-fatal" eq "$rc" 0
check "night: the body is copied, so a temp file can go" rm "$WORK/body.md"
ALERT_HUB_REPORT_TOKEN=report-token send_queued_reports
check "morning: sent with the queued key and subject" \
  eq "$(hub_field 3)|$(hub_field 5)" "report:infra-drift:2026-11-07|Night"
check "morning: sent whole" eq "$(hub_message)" "night report"
check "morning: removed from the queue" eq "$(queued)" 0

# --- send hours: 07:30 up to, not including, 20:00 ---------------------------------------------
for t in 0729:0 0730:1 1959:1 2000:0; do
  reset; printf 'x\n' > "$WORK/body.md"
  REPORT_NOW_HHMM=${t%%:*} ALERT_HUB_REPORT_TOKEN=report-token queue_report "k" "S" "$WORK/body.md" "/r"
  check "send hours: at ${t%%:*} sends=${t##*:}" eq "$([ -s "$WORK/hub.args" ] && echo 1 || echo 0)" "${t##*:}"
done

# --- a failed send stays queued and goes out on the next send ------------------------------------
reset; printf 'retry me\n' > "$WORK/body.md"
REPORT_NOW_HHMM=0300 queue_report "k" "S" "$WORK/body.md" "/r"
STUB_HUB_RC=1 ALERT_HUB_REPORT_TOKEN=report-token send_queued_reports
check "failed send: still queued" eq "$(queued)" 1
check "failed send: WARN logged" logged_warn
ALERT_HUB_REPORT_TOKEN='' send_queued_reports
check "no token: still queued" eq "$(queued)" 1
rm -f "$WORK/hub.args"
ALERT_HUB_REPORT_TOKEN=report-token send_queued_reports
check "next send: sent" eq "$(hub_message)" "retry me"
check "next send: queue empty" eq "$(queued)" 0

# --- a failed queue leaves no partial entry behind ----------------------------------------------
reset; mkdir -p "$WORK/outbox"; printf 'x\n' > "$WORK/body.md"
cp() { return 1; }
REPORT_NOW_HHMM=0300 queue_report "k" "S" "$WORK/body.md" "/r"
unset -f cp
check "failed queue: nothing queued" eq "$(queued)" 0
check "failed queue: no partial entry" eq "$(find "$WORK/outbox" -mindepth 1 | wc -l | tr -d ' ')" 0
check "failed queue: WARN logged" logged_warn

# --- a report another send already claimed is skipped, not sent twice ------------------------------
reset; printf 'once\n' > "$WORK/body.md"
REPORT_NOW_HHMM=0300 queue_report "k" "S" "$WORK/body.md" "/r"
entry="$(find "$WORK/outbox" -mindepth 1 -maxdepth 1 -name '[0-9]*')"
mv "$entry" "$WORK/outbox/.sending.999.${entry##*/}"
ALERT_HUB_REPORT_TOKEN=report-token send_queued_reports
check "claimed elsewhere: not sent" absent "$WORK/hub.args"

# --- load_alert_hub_tokens: fetch each token by its BWS_*_ID, otherwise leave it unset -------------
get_secret_by_id() { printf 'value-of-%s' "$1"; }
export_state() { env | grep -E '^ALERT_HUB_(REPORT_)?TOKEN=' | sort | tr '\n' ' '; }
check "tokens: both fetched when both IDs are set" eq \
  "$(BWS_ALERT_HUB_TOKEN_ID=hub-id BWS_ALERT_HUB_REPORT_TOKEN_ID=rep-id bash -c \
    "$(declare -f get_secret_by_id export_state); . '$ROOT/scripts/lib/report-notice.sh'; load_alert_hub_tokens; export_state")" \
  "ALERT_HUB_REPORT_TOKEN=value-of-rep-id ALERT_HUB_TOKEN=value-of-hub-id "
check "tokens: default IDs are used when no ID is set, ignoring inherited tokens" eq \
  "$(ALERT_HUB_TOKEN=stale ALERT_HUB_REPORT_TOKEN=stale bash -c \
    "$(declare -f get_secret_by_id export_state); . '$ROOT/scripts/lib/report-notice.sh'; load_alert_hub_tokens; export_state")" \
  "ALERT_HUB_REPORT_TOKEN=value-of-4ed74de3-09d4-408f-917a-b4ee00feba75 ALERT_HUB_TOKEN=value-of-7a36a369-c649-4893-a768-b4ee00feb92a "

exit "$FAILED"
