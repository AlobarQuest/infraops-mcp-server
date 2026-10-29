#!/bin/bash
# shellcheck disable=SC2329 # helpers run indirectly through check()
# Runs .claude/hooks/session-sync.sh in a scratch clone of a scratch origin, with a stub npm on PATH.
# Nothing real is touched: the hook resolves its repo from its own location, so it is copied into the clone.
# Run: bash tests/session-sync.test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILED=0
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

mkdir -p "$WORK/bin"
cat > "$WORK/bin/npm" <<'STUB'
#!/bin/bash
echo "$*" >> "$STUB_DIR/npm.calls"
[ "${NPM_FAIL:-0}" = 1 ] && { echo 'npm ERR! "boom" \ failed'; exit 1; }
exit 0
STUB
chmod +x "$WORK/bin/npm"

check() { # check <name> <command...>
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; FAILED=1; fi
}

# scenario <name> <file-to-change>: origin gets one new commit touching <file>; the clone (on main,
# clean, behind by one) then runs the hook. Leaves npm.calls, out.json and rc in $WORK/<name>/.
scenario() {
  local d="$WORK/$1" file=$2
  mkdir -p "$d"
  git init -q --bare -b main "$d/origin.git"
  git clone -q "$d/origin.git" "$d/seed" 2>/dev/null
  mkdir -p "$d/seed/.claude/hooks"
  cp "$ROOT/.claude/hooks/session-sync.sh" "$d/seed/.claude/hooks/"
  echo '{}' > "$d/seed/package-lock.json"; echo hi > "$d/seed/README.md"
  git -C "$d/seed" add -A && git -C "$d/seed" commit -q -m seed && git -C "$d/seed" push -q origin main
  git clone -q "$d/origin.git" "$d/clone"
  echo "$RANDOM" >> "$d/seed/$file"
  git -C "$d/seed" commit -q -am change && git -C "$d/seed" push -q origin main
  env PATH="$WORK/bin:$PATH" STUB_DIR="$d" NPM_FAIL="${NPM_FAIL:-0}" \
    bash "$d/clone/.claude/hooks/session-sync.sh" >"$d/out.json" 2>/dev/null
  echo $? > "$d/rc"
}

lockfile_runs_npm() {
  scenario lock package-lock.json
  grep -qx 'ci --no-audit --no-fund' "$WORK/lock/npm.calls" \
    && jq -e '.hookSpecificOutput.additionalContext | contains("npm ci") and contains("/mcp reconnect infraops")' "$WORK/lock/out.json" >/dev/null
}
readme_skips_npm() {
  scenario readme README.md
  [ ! -e "$WORK/readme/npm.calls" ] && jq -e . "$WORK/readme/out.json" >/dev/null
}
npm_failure_exits_zero() {
  NPM_FAIL=1 scenario fail package-lock.json
  [ "$(cat "$WORK/fail/rc")" = 0 ] \
    && jq -e '.hookSpecificOutput.additionalContext | contains("npm ci") and contains("FAILED") and contains("by hand")' "$WORK/fail/out.json" >/dev/null
}

check "lockfile change runs npm ci" lockfile_runs_npm
check "no lockfile change skips npm" readme_skips_npm
check "npm failure still exits 0" npm_failure_exits_zero
exit "$FAILED"
