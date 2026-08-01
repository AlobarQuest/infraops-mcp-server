#!/bin/bash
# Refresh app-brain's github_repo + environments from LIVE Coolify — the producer
# side of the app-conformance loop whose consumer (the remediation handoff's
# repo+branch resolver) reads this same data. Co-located with the 03:00 drift
# pipeline (called as a guarded pre-step by drift-audit.sh), so the resolver always
# reads freshly-synced data. Also runnable standalone for on-demand refreshes from
# the Mac (which, unlike a VPS-side run, also reaches dev Coolify).
#
# The actual sync is the already-merged, idempotent brain script
# (~/Projects/brain/scripts/sync_deployment_from_coolify.py): dry-run by default,
# Coolify read-only, app-brain the write target, UPDATE-by-slug. This wrapper only
# supplies what that script needs at runtime — nothing more.
#
# DB ACCESS (no new capability, no new exposure): the prod app-brain Postgres
# (Coolify resource brain-app-db, container x1rt6fvevdzmkp34a8wprl76, db "appbrain")
# has no host-published port (is_public=false). We reach it the same way infraops'
# vps_* tools already do — the existing Hetzner SSH key — by opening a localhost-only
# `ssh -L` forward into the container for the duration of the run. The DB password is
# fetched at runtime over that same SSH (the brain-app-db's own POSTGRES_PASSWORD) and
# is NEVER written to disk, logged, or committed; it lives only in this process's env
# and the python child's, and is torn down with the tunnel.
#
# MODE: dry-run by default (writes nothing — safe to schedule as-is). Pass --apply, or
# set APPBRAIN_SYNC_APPLY=1, to write. Rollout: schedule in dry-run, review the logged
# diff, then flip APPBRAIN_SYNC_APPLY=1 in $HOME/.config/infra-drift/env.
#
# Exit status is advisory only — drift-audit.sh calls this best-effort and never lets
# a sync failure abort the audit.
set -uo pipefail

log() { echo "[appbrain-sync $(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

# ── Config (all defaulted inline; overridable via the sourced drift env file) ──────
VPS_HOST="${VPS_HOST:-178.156.247.239}"
VPS_USER="${VPS_USER:-root}"
# The infraops MCP points VPS_SSH_KEY_PATH at hetzner_infraops via its .claude.json
# env; that env isn't present under the drift launchd context, so default to it here.
VPS_SSH_KEY_PATH="${VPS_SSH_KEY_PATH:-$HOME/.ssh/hetzner_infraops}"
# Coolify standalone-DB containers are named by their (stable) resource UUID.
APPBRAIN_DB_CONTAINER="${APPBRAIN_DB_CONTAINER:-x1rt6fvevdzmkp34a8wprl76}"
APPBRAIN_DB_NAME="${APPBRAIN_DB_NAME:-appbrain}"
APPBRAIN_DB_USER="${APPBRAIN_DB_USER:-postgres}"
APPBRAIN_SYNC_LOCAL_PORT="${APPBRAIN_SYNC_LOCAL_PORT:-55432}"
BRAIN_REPO="${BRAIN_REPO:-$HOME/Projects/brain}"
BRAIN_PYTHON="${BRAIN_PYTHON:-$BRAIN_REPO/venv/bin/python}"
SYNC_SCRIPT="$BRAIN_REPO/scripts/sync_deployment_from_coolify.py"

# Mode: --apply arg or APPBRAIN_SYNC_APPLY=1 -> write; otherwise dry-run.
APPLY_FLAG=""
[ "${APPBRAIN_SYNC_APPLY:-0}" = "1" ] && APPLY_FLAG="--apply"
[ "${1:-}" = "--apply" ] && APPLY_FLAG="--apply"

# ── Preflight ──────────────────────────────────────────────────────────────────
[ -x "$BRAIN_PYTHON" ] || fail "brain venv python not executable at $BRAIN_PYTHON (run: python3 -m venv $BRAIN_REPO/venv && pip install -r requirements)"
[ -f "$SYNC_SCRIPT" ]  || fail "sync script missing at $SYNC_SCRIPT"
[ -f "$VPS_SSH_KEY_PATH" ] || fail "VPS SSH key missing at $VPS_SSH_KEY_PATH"

# The python script fetches Coolify API tokens from BWS itself, so it needs a BWS
# token. drift-audit.sh exports BWS_ACCESS_TOKEN before calling us; for a standalone
# run, bootstrap it from the login Keychain via the sibling helper.
if [ -z "${BWS_ACCESS_TOKEN:-}" ]; then
  # shellcheck disable=SC1091
  source "$(dirname "${BASH_SOURCE[0]}")/bws-token.sh" 2>/dev/null || true
fi
[ -n "${BWS_ACCESS_TOKEN:-}" ] || fail "BWS_ACCESS_TOKEN not set (needed for the script's Coolify token fetch)"

SSH_OPTS=(-i "$VPS_SSH_KEY_PATH" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

# ── Resolve the DB container's coolify-network IP (re-queried each run; survives a
#    container recreate that changes the IP) ────────────────────────────────────
# shellcheck disable=SC2029  # $APPBRAIN_DB_CONTAINER MUST expand client-side: it is
# local config the VPS has no knowledge of. The Go template braces are escaped so they
# reach the remote docker verbatim; only the container name is interpolated here.
DB_IP="$(ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" \
  "docker inspect -f '{{range \$k,\$v := .NetworkSettings.Networks}}{{if eq \$k \"coolify\"}}{{\$v.IPAddress}}{{end}}{{end}}' $APPBRAIN_DB_CONTAINER" 2>/dev/null)"
DB_IP="$(echo "$DB_IP" | tr -d '[:space:]')"
[ -n "$DB_IP" ] || fail "could not resolve $APPBRAIN_DB_CONTAINER IP on the coolify network (container down? renamed?)"
log "brain-app-db at ${DB_IP}:5432 on coolify network (via $VPS_HOST)"

# ── Fetch the DB password over the same SSH (never logged/persisted) ───────────────
# shellcheck disable=SC2029  # same as above: the container name is local config and
# must expand here, not on the VPS.
DB_PW="$(ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" \
  "docker exec $APPBRAIN_DB_CONTAINER printenv POSTGRES_PASSWORD" 2>/dev/null)"
[ -n "$DB_PW" ] || fail "could not read brain-app-db POSTGRES_PASSWORD"
# Percent-encode for safe embedding in the URL (robust to any special chars).
DB_PW_ENC="$(P="$DB_PW" python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["P"],safe=""))')"

# ── Open the localhost-only forward; tear it down on exit no matter what ───────────
ssh "${SSH_OPTS[@]}" -o ExitOnForwardFailure=yes -N \
  -L "127.0.0.1:${APPBRAIN_SYNC_LOCAL_PORT}:${DB_IP}:5432" "$VPS_USER@$VPS_HOST" &
SSH_PID=$!
# Inlined rather than a `cleanup` function: shellcheck cannot connect `trap cleanup EXIT`
# to the definition and reports the function as dead — as SC2329 on the definition in
# 0.11 (local) but as SC2317 on each body command in 0.9 (what CI's apt-get installs).
# Suppressing that would have meant naming both codes and hoping no third version
# invents a fourth. With no function there is nothing to call dead. $SSH_PID is set
# above and expands when the trap fires, exactly as it did inside the function.
trap 'kill "$SSH_PID" 2>/dev/null; wait "$SSH_PID" 2>/dev/null' EXIT

# Wait for the forward to accept connections (or bail if the tunnel died).
READY=""
for _ in $(seq 1 20); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${APPBRAIN_SYNC_LOCAL_PORT}") 2>/dev/null; then
    exec 3>&- 3<&-; READY=1; break
  fi
  kill -0 "$SSH_PID" 2>/dev/null || break
  sleep 0.5
done
[ -n "$READY" ] || fail "ssh -L tunnel to ${DB_IP}:5432 did not come up"

# ── Run the (untouched) idempotent sync against the forwarded port ─────────────────
export DATABASE_URL="postgresql+asyncpg://${APPBRAIN_DB_USER}:${DB_PW_ENC}@127.0.0.1:${APPBRAIN_SYNC_LOCAL_PORT}/${APPBRAIN_DB_NAME}"
log "running sync ${APPLY_FLAG:-(dry-run)} via $BRAIN_PYTHON"
"$BRAIN_PYTHON" "$SYNC_SCRIPT" $APPLY_FLAG
RC=$?
unset DATABASE_URL DB_PW DB_PW_ENC
log "sync finished rc=$RC ${APPLY_FLAG:-(dry-run)}"
exit $RC
