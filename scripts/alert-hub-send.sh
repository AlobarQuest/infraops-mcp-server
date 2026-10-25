#!/usr/bin/env bash
# Vendored verbatim from alert-hub clients/alert-hub-send.sh at alert-hub commit af458ab.
# Send one alert or notice to alert-hub.
#
#   alert-hub-send.sh [--notice] [--resolved] [--] <key> <severity> <title> [message]
#
# Flags must come before the positionals; parsing stops at the first non-flag argument, and `--`
# ends the flags explicitly.
#
# Environment: ALERT_HUB_TOKEN (required), ALERT_HUB_URL (default https://alerts.alobar.net),
# ALERT_HUB_TIMEOUT (seconds, default 10).
# Exits 0 when the hub answers 202, otherwise prints one line to stderr and exits 1.
set -u

usage() {
  echo "usage: alert-hub-send.sh [--notice] [--resolved] [--] <key> <severity> <title> [message]" >&2
  exit 1
}

fail() {
  echo "alert-hub-send: $1" >&2
  exit 1
}

# The C0 controls other than tab, LF and CR (bash strings can't hold NUL).
C0_OTHER=$'\001\002\003\004\005\006\007\010\013\014\016\017\020\021\022\023\024\025\026\027\030\031\032\033\034\035\036\037'
# On bash 3.2 a ${s//x/y} costs the length times the matches, and ${s:i:1} the offset, so
# escaping in chunks keeps a long message linear: 12,000 characters took 16 s one at a time.
ESCAPE_CHUNK=256

# Escapes every U+0000-U+001F character plus backslash and double quote; other UTF-8 passes through.
json_escape() {
  local s=$1 out="" c i n
  for ((i = 0; i < ${#s}; i += ESCAPE_CHUNK)); do
    c=${s:i:ESCAPE_CHUNK}
    c=${c//\\/\\\\}
    c=${c//\"/\\\"}
    c=${c//$'\n'/\\n}
    c=${c//$'\r'/\\r}
    c=${c//$'\t'/\\t}
    out+=$c
  done
  case $out in
    *["$C0_OTHER"]*) ;;
    *) printf '%s' "$out"; return ;;
  esac
  # Rare: another control character needs a \uXXXX escape, one character at a time.
  s=${out//$'\b'/\\b}
  s=${s//$'\f'/\\f}
  out=""
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    printf -v n '%d' "'$c"
    if ((n >= 0 && n < 32)); then
      printf -v c '\\u%04x' "$n"
    fi
    out+=$c
  done
  printf '%s' "$out"
}

build_json() { # build_json <key> <severity> <title> <message> <status> <kind>
  if command -v jq >/dev/null 2>&1; then
    jq -cn --arg key "$1" --arg severity "$2" --arg title "$3" --arg message "$4" \
      --arg status "$5" --arg kind "$6" \
      '{key: $key, severity: $severity, title: $title, status: $status, kind: $kind}
       + (if $message == "" then {} else {message: $message} end)'
    return
  fi
  local out
  out="{\"key\":\"$(json_escape "$1")\",\"severity\":\"$(json_escape "$2")\",\"title\":\"$(json_escape "$3")\""
  if [ -n "$4" ]; then out+=",\"message\":\"$(json_escape "$4")\""; fi
  printf '%s,"status":"%s","kind":"%s"}' "$out" "$5" "$6"
}

status=firing
kind=alert
while [ $# -gt 0 ]; do
  case $1 in
    --notice) kind=notice ;;
    --resolved) status=resolved ;;
    --) shift; break ;;
    *) break ;;
  esac
  shift
done
args=("$@")
[ "${#args[@]}" -ge 3 ] || usage

token=${ALERT_HUB_TOKEN:-}
[ -n "$token" ] || fail "ALERT_HUB_TOKEN is not set"
case $token in
  *$'\n'* | *$'\r'*) echo "usage: ALERT_HUB_TOKEN must not contain a newline" >&2; exit 1 ;;
esac
base=${ALERT_HUB_URL:-https://alerts.alobar.net}

# The token goes to curl through a config descriptor, not argv, so `ps` never shows it.
code=$(
  build_json "${args[0]}" "${args[1]}" "${args[2]}" "${args[3]:-}" "$status" "$kind" |
    curl -sS -o /dev/null -w '%{http_code}' --max-time "${ALERT_HUB_TIMEOUT:-10}" \
      -K <(printf 'header = "Authorization: Bearer %s"\n' "$(json_escape "$token")") \
      -H 'Content-Type: application/json' -A 'alert-hub-client/1 (shell)' \
      --data-binary @- "${base%/}/v1/alerts" 2>/dev/null
) || code=000

[ "$code" = 202 ] || fail "send failed (HTTP $code)"
