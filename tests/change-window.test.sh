#!/bin/bash
# shellcheck disable=SC2317  # the stubs below are called indirectly by the wrapper under test
# Runs scripts/change-window.sh against stubs (bws, node, curl on PATH; a temporary HOME) and checks
# what the CLI it launches sees in its environment. Nothing live is contacted.
# Run: bash tests/change-window.test.sh
# shellcheck disable=SC2329 # helpers run indirectly through check()
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILED=0

mkdir -p "$WORK/bin" "$WORK/home" "$WORK/repo/dist/cli"
cat > "$WORK/bin/bws" <<'STUB'
#!/bin/bash
# bws secret get <id> ...: answer with a value derived from the id.
printf '{"value":"value-of-%s"}\n' "$3"
STUB
cat > "$WORK/bin/node" <<'STUB'
#!/bin/bash
# Record the environment the CLI sees; the argument after the script names the command.
{ echo "== $2"; env | grep -E '^(RESEND_API_KEY|ALERT_HUB_TOKEN|ALERT_HUB_REPORT_TOKEN)=' | sort; } >> "$STUB_DIR/node.env"
STUB
printf '#!/bin/bash\nexit 0\n' > "$WORK/bin/curl"
chmod +x "$WORK/bin"/*

check() { # check <name> <command...>
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; FAILED=1; fi
}

# run_wrapper [VAR=value ...]: run change-window.sh once, with the given extra environment.
run_wrapper() {
  rm -f "$WORK/node.env"
  env -i PATH="$WORK/bin:/usr/bin:/bin" HOME="$WORK/home" STUB_DIR="$WORK" BWS_ACCESS_TOKEN=fake \
    INFRADRIFT_ENV=/nonexistent INFRADRIFT_REPO="$WORK/repo" INFRADRIFT_REPORT_DIR="$WORK/reports" \
    INFRADRIFT_CW_LOG="$WORK/cw.log" "$@" bash "$ROOT/scripts/change-window.sh" >"$WORK/out.log" 2>&1
}
# env_of <command>: the environment lines recorded for one CLI command.
env_of() { sed -n "/^== $1\$/,/^==/p" "$WORK/node.env" | grep -v '^=='; }

run_wrapper
check "run-security-window sees the default ALERT_HUB_TOKEN for the integrity-refusal notice" \
  grep -qx 'ALERT_HUB_TOKEN=value-of-7a36a369-c649-4893-a768-b4ee00feb92a' < <(env_of run-security-window)
no_resend() { ! grep -q RESEND_API_KEY "$WORK/node.env"; }
check "the CLIs get no RESEND_API_KEY" no_resend

run_wrapper BWS_ALERT_HUB_TOKEN_ID=hub-id BWS_ALERT_HUB_REPORT_TOKEN_ID=rep-id
check "run-security-window sees a token from an overriding ID" \
  grep -qx 'ALERT_HUB_TOKEN=value-of-hub-id' < <(env_of run-security-window)

exit "$FAILED"
