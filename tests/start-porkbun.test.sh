#!/bin/bash
# shellcheck disable=SC2317  # the stubs below are called indirectly by the script under test
# Runs start.sh against stubs (bws, node on PATH; a temporary HOME) and checks which PORKBUN_*
# values the node process it execs sees. Nothing live is contacted. start.sh calls
# /usr/bin/security by absolute path, so it may load the real BWS token from Keychain; the stub bws
# ignores the token, and this test never prints, logs or records BWS_ACCESS_TOKEN.
# Run: bash tests/start-porkbun.test.sh
# shellcheck disable=SC2329 # helpers run indirectly through check()
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILED=0

mkdir -p "$WORK/bin" "$WORK/home"
cat > "$WORK/bin/bws" <<'STUB'
#!/bin/bash
# bws secret get <id> ...: answer with a value derived from the id; fail Porkbun ids on request
# (STUB_BWS_FAIL=api, secret or both).
case "$3:${STUB_BWS_FAIL:-}" in 27e165db-*:api|28acc253-*:secret|27e165db-*:both|28acc253-*:both) exit 1 ;; esac
printf '{"value":"value-of-%s"}\n' "$3"
STUB
cat > "$WORK/bin/node" <<'STUB'
#!/bin/bash
# Record only the two Porkbun variables (never the environment as a whole).
{ echo "PORKBUN_API_KEY=${PORKBUN_API_KEY-}"; echo "PORKBUN_SECRET_API_KEY=${PORKBUN_SECRET_API_KEY-}"; echo "exec"; } > "$STUB_DIR/node.env"
STUB
chmod +x "$WORK/bin"/*

check() { # check <name> <command...>
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; FAILED=1; fi
}

# run_start [VAR=value ...]: run start.sh once, with the given extra environment.
run_start() {
  rm -f "$WORK/node.env"
  env -i PATH="$WORK/bin:/usr/bin:/bin" HOME="$WORK/home" STUB_DIR="$WORK" BWS_ACCESS_TOKEN=fake \
    BWS_COOLIFY_PROD_SECRET_ID=coolify-id "$@" bash "$ROOT/start.sh" >"$WORK/out.log" 2>&1
}
recorded() { grep -qx "$1" "$WORK/node.env" 2>/dev/null; }

run_start
check "default UUIDs" bash -c "$(declare -f recorded); WORK='$WORK'; \
  recorded 'PORKBUN_API_KEY=value-of-27e165db-5d54-4176-94df-b4f201476bed' && \
  recorded 'PORKBUN_SECRET_API_KEY=value-of-28acc253-51e3-4ee1-8a04-b4f2014782fe'"

run_start BWS_PORKBUN_API_KEY_SECRET_ID="" BWS_PORKBUN_SECRET_KEY_SECRET_ID=""
check "empty disables" bash -c "$(declare -f recorded); WORK='$WORK'; \
  recorded 'PORKBUN_API_KEY=' && recorded 'PORKBUN_SECRET_API_KEY=' && recorded exec"
no_warn() { ! grep -q 'WARN: failed to fetch Porkbun' "$WORK/out.log"; }
check "empty disables: no WARN" no_warn

warned() { grep -qx "WARN: failed to fetch Porkbun $1 from BWS — Porkbun tools disabled" "$WORK/out.log"; }

run_start STUB_BWS_FAIL=both
check "fetch failure does not exit" bash -c "$(declare -f recorded); WORK='$WORK'; \
  recorded exec && recorded 'PORKBUN_API_KEY=' && recorded 'PORKBUN_SECRET_API_KEY='"
check "both failed: WARN names both" warned "API key and secret key"

run_start STUB_BWS_FAIL=api
check "API key failed: WARN names it" warned "API key"

run_start STUB_BWS_FAIL=secret
check "secret key failed: WARN names it" warned "secret key"

exit "$FAILED"
