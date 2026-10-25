#!/bin/bash
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
EMAIL_FROM=from@example.com
EMAIL_TO=to@example.com
export STUB_DIR="$WORK" ALERT_HUB_SEND="$WORK/hub-send" PATH="$WORK/bin:$PATH"
# shellcheck source=../scripts/lib/report-notice.sh
. "$ROOT/scripts/lib/report-notice.sh"

units() { python3 -c 'import sys; print(len(sys.stdin.read().encode("utf-16-le")) // 2)'; }

check() { # check <name> <command...>
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; FAILED=1; fi
}

reset() { rm -f "$WORK"/{curl.args,hub.args,hub.token,log}; unset STUB_HUB_RC; }
# Fields of the recorded helper call, one per line: --notice, --, key, severity, subject, message.
hub_field() { tr '\0' '\n' < "$WORK/hub.args" | sed -n "${1}p"; }
hub_message() { python3 -c 'import sys; print(sys.stdin.buffer.read().split(b"\0")[5].decode(), end="")' < "$WORK/hub.args"; }
hub_called() { [ -s "$WORK/hub.args" ]; }
not_in_argv() { ! tr '\0' '\n' < "$WORK/hub.args" | grep -q "$1"; }
absent() { [ ! -e "$1" ]; }
resend_called() { grep -q 'api.resend.com' "$WORK/curl.args" 2>/dev/null; }

# make_body <n>: n repetitions of "a" + one emoji, which is 3 UTF-16 units each.
make_body() { python3 -c "import sys; sys.stdout.write('a😀' * int(sys.argv[1]))" "$1" > "$WORK/body.md"; }
eq() { [ "$1" = "$2" ]; }

# --- hub path: a long body with emoji is cut to 12,000 characters with the footer ----------------
reset; make_body 10000
ALERT_HUB_REPORT_TOKEN=report-token RESEND_API_KEY=resend-key \
  send_report "report:infra-drift:2026-10-25" "Subject" "$WORK/body.md" "/reports/2026-10-25.md"
msg="$(hub_message)"
check "long body: sent as a notice with key, info, subject" \
  eq "$(hub_field 1)|$(hub_field 3)|$(hub_field 4)|$(hub_field 5)" \
  "--notice|report:infra-drift:2026-10-25|info|Subject"
check "long body: at most 12000 characters" test "$(printf '%s' "$msg" | units)" -le 12000
check "long body: ends with the footer" \
  eq "${msg##*$'\n\n'}" "… (cut at 12,000 of 30,000 characters; full report: /reports/2026-10-25.md on the Mac mini)"
check "long body: Resend not called" absent "$WORK/curl.args"
check "long body: token reaches the helper by environment only" \
  eq "$(cat "$WORK/hub.token")" report-token
check "long body: token is not in argv" not_in_argv report-token

# --- hub path: a short body goes whole ------------------------------------------------------------
reset; printf 'short report 😀\n' > "$WORK/body.md"
ALERT_HUB_REPORT_TOKEN=report-token send_report "k" "S" "$WORK/body.md" "/x.md"
check "short body: sent whole" eq "$(hub_message)" "$(cat "$WORK/body.md")"

# --- hub path: a body of exactly 12000 characters goes whole ----------------------------------
reset; make_body 4000
ALERT_HUB_REPORT_TOKEN=report-token send_report "k" "S" "$WORK/body.md" "/x.md"
check "boundary body: sent whole" test "$(hub_message | units)" -eq 12000

# --- no hub token: the Resend branch runs ----------------------------------------------------------
reset; printf 'short\n' > "$WORK/body.md"
ALERT_HUB_REPORT_TOKEN='' RESEND_API_KEY=resend-key send_report "k" "S" "$WORK/body.md" "/x.md"
check "no token: Resend called" resend_called
check "no token: hub not called" absent "$WORK/hub.args"

# --- hub failure: falls through to Resend ----------------------------------------------------------
reset; printf 'short\n' > "$WORK/body.md"
STUB_HUB_RC=1 ALERT_HUB_REPORT_TOKEN=report-token RESEND_API_KEY=resend-key \
  send_report "k" "S" "$WORK/body.md" "/x.md"
check "hub failure: hub tried" hub_called
check "hub failure: Resend called" resend_called

# --- missing body: nothing is sent -----------------------------------------------------------------
reset
ALERT_HUB_REPORT_TOKEN=report-token RESEND_API_KEY=resend-key send_report "k" "S" "$WORK/absent.md" "/x.md"
check "missing body: hub not called" absent "$WORK/hub.args"
check "missing body: Resend not called" absent "$WORK/curl.args"

exit "$FAILED"
