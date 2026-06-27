#!/bin/bash
# InfraOps MCP Server launcher
# Fetches secrets from BWS at startup so they never live in config files.
#
# Required env vars (set in .claude.json):
#   COOLIFY_BASE_URL            - Prod Coolify instance URL (or COOLIFY_PROD_BASE_URL)
#   BWS_COOLIFY_SECRET_ID       - BWS secret ID for the prod Coolify API token
#
# Optional env vars:
#   COOLIFY_DEV_BASE_URL        - Dev Coolify instance URL (e.g. http://192.168.139.217:8000)
#   BWS_COOLIFY_DEV_SECRET_ID   - BWS secret ID for the dev Coolify API token
#   BWS_HETZNER_SECRET_ID       - BWS secret ID for the Hetzner Cloud API token
#   BWS_SSH_PASSPHRASE_SECRET_ID - BWS secret ID for the SSH key passphrase
#   VPS_HOST                    - VPS IP address (default: 178.156.247.239)
#   VPS_USER                    - SSH user (default: root)
#   VPS_SSH_KEY_PATH            - Path to SSH private key (default: ~/.ssh/hetzner_ed25519)
#   NAMECHEAP_USE_SANDBOX       - "true" for sandbox, "false" for production (default: "true")
#
# Namecheap credentials are fetched from BWS by name (no env vars needed):
#   Sandbox: NAMECHEAP_SANDBOX_API_USER, NAMECHEAP_SANDBOX_API_KEY
#   Production: NAMECHEAP_API_USER, NAMECHEAP_API_KEY
#   Proxy token: NAMECHEAP_PROXY_BEARER_TOKEN

set -euo pipefail

# ── BWS access token (de-inlined → macOS Keychain) ──────────────────
# Keychain is the source of truth: prefer it over any (possibly stale/inherited) env token.
# A dead BWS_ACCESS_TOKEN inherited from the launching Claude process used to slip past the old
# `[ -z ]` guard and break the BWS fetch in some launch contexts (e.g. cwd=devon-plugins).
_kc_bws="$(/usr/bin/security find-generic-password -s 'Claude' -a 'BWS_ACCESS_TOKEN_INFRAOPS' -w 2>/dev/null || true)"
if [ -n "$_kc_bws" ]; then
  export BWS_ACCESS_TOKEN="$_kc_bws"
elif [ -z "${BWS_ACCESS_TOKEN:-}" ]; then
  echo "ERROR: BWS_ACCESS_TOKEN not in env or Keychain (Claude/BWS_ACCESS_TOKEN_INFRAOPS)" >&2
  exit 1
fi
unset _kc_bws

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Helper: fetch a BWS secret by ID, returns empty string if ID not set
fetch_bws_secret() {
  local secret_id="$1"
  if [ -z "$secret_id" ]; then
    echo ""
    return
  fi
  bws secret get "$secret_id" --output json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])" 2>/dev/null || echo ""
}

# ── Coolify (required) ──────────────────────────────────────────────
export COOLIFY_API_TOKEN=$(fetch_bws_secret "${BWS_COOLIFY_PROD_SECRET_ID:-${BWS_COOLIFY_SECRET_ID:-}}")

if [ -z "$COOLIFY_API_TOKEN" ]; then
  echo "ERROR: Failed to fetch Coolify API token from BWS (secret ID: ${BWS_COOLIFY_PROD_SECRET_ID:-${BWS_COOLIFY_SECRET_ID:-not set}})" >&2
  exit 1
fi

# ── Coolify Dev (optional) ─────────────────────────────────────────
if [ -n "${BWS_COOLIFY_DEV_SECRET_ID:-}" ]; then
  export COOLIFY_DEV_API_TOKEN=$(fetch_bws_secret "$BWS_COOLIFY_DEV_SECRET_ID")
  if [ -n "$COOLIFY_DEV_API_TOKEN" ]; then
    echo "Coolify dev API token loaded from BWS" >&2
  else
    echo "WARN: BWS_COOLIFY_DEV_SECRET_ID set but failed to fetch token" >&2
  fi
fi

# ── Hetzner Cloud API (optional) ────────────────────────────────────
if [ -n "${BWS_HETZNER_SECRET_ID:-}" ]; then
  export HETZNER_API_TOKEN=$(fetch_bws_secret "$BWS_HETZNER_SECRET_ID")
  if [ -n "$HETZNER_API_TOKEN" ]; then
    echo "Hetzner Cloud API token loaded from BWS" >&2
  else
    echo "WARN: BWS_HETZNER_SECRET_ID set but failed to fetch token" >&2
  fi
fi

# ── GitHub API (optional) ──────────────────────────────────────────
export GITHUB_TOKEN=$(fetch_bws_secret "${BWS_GITHUB_PAT_SECRET_ID:-9d4780d3-bada-45be-a83e-b415013c46ed}")
if [ -n "$GITHUB_TOKEN" ]; then
  echo "GitHub API token loaded from BWS" >&2
fi

# ── SSH Key Passphrase (optional) ───────────────────────────────────
if [ -n "${BWS_SSH_PASSPHRASE_SECRET_ID:-}" ]; then
  export VPS_SSH_PASSPHRASE=$(fetch_bws_secret "$BWS_SSH_PASSPHRASE_SECRET_ID")
  if [ -n "$VPS_SSH_PASSPHRASE" ]; then
    echo "SSH key passphrase loaded from BWS" >&2
  else
    echo "WARN: BWS_SSH_PASSPHRASE_SECRET_ID set but failed to fetch passphrase" >&2
  fi
fi

# ── Namecheap API (optional) ───────────────────────────────────────
# Default to sandbox mode for safety
export NAMECHEAP_USE_SANDBOX="${NAMECHEAP_USE_SANDBOX:-true}"

# Reference secrets by stable UUID (infra-brain lesson #277). Production UUIDs are defaulted
# inline (non-secret, useless without BWS_ACCESS_TOKEN); override via env if they ever change.
# Sandbox secrets are not provisioned in BWS, so their IDs default empty — fetch returns ""
# (same behaviour as the prior by-name lookup, which also found nothing for sandbox).
if [ "${NAMECHEAP_USE_SANDBOX}" = "true" ]; then
  NC_USER_SECRET_ID="${BWS_NAMECHEAP_SANDBOX_API_USER_SECRET_ID:-}"
  NC_KEY_SECRET_ID="${BWS_NAMECHEAP_SANDBOX_API_KEY_SECRET_ID:-}"
  NC_ENV_LABEL="sandbox"
else
  NC_USER_SECRET_ID="${BWS_NAMECHEAP_PROD_API_USER_SECRET_ID:-506f7af7-0844-4f69-b5c2-b4020115a388}"
  NC_KEY_SECRET_ID="${BWS_NAMECHEAP_PROD_API_KEY_SECRET_ID:-cd0f8751-7938-45cb-947d-b4020115d1e6}"
  NC_ENV_LABEL="production"
fi

export NAMECHEAP_API_USER=$(fetch_bws_secret "$NC_USER_SECRET_ID")
if [ -n "$NAMECHEAP_API_USER" ]; then
  echo "Namecheap API user loaded from BWS (${NC_ENV_LABEL})" >&2
fi

export NAMECHEAP_API_KEY=$(fetch_bws_secret "$NC_KEY_SECRET_ID")
if [ -n "$NAMECHEAP_API_KEY" ]; then
  echo "Namecheap API key loaded from BWS (${NC_ENV_LABEL})" >&2
fi

# Proxy bearer token for namecheap-proxy.devonwatkins.com
export NAMECHEAP_PROXY_TOKEN=$(fetch_bws_secret "${BWS_NAMECHEAP_PROXY_SECRET_ID:-0b6525ee-101e-4a59-887b-b41401304be8}")
if [ -n "$NAMECHEAP_PROXY_TOKEN" ]; then
  echo "Namecheap proxy token loaded from BWS" >&2
fi

if [ -n "${NAMECHEAP_API_USER:-}" ] && [ -n "${NAMECHEAP_API_KEY:-}" ] && [ -n "${NAMECHEAP_PROXY_TOKEN:-}" ]; then
  echo "Namecheap tools enabled (env: ${NC_ENV_LABEL}, via VPS proxy)" >&2
fi

# ── Cloudflare API (optional) ────────────────────────────────────
if [ -n "${BWS_CLOUDFLARE_SECRET_ID:-}" ]; then
  export CLOUDFLARE_API_TOKEN=$(fetch_bws_secret "$BWS_CLOUDFLARE_SECRET_ID")
  if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    echo "Cloudflare API token loaded from BWS" >&2
  else
    echo "WARN: BWS_CLOUDFLARE_SECRET_ID set but failed to fetch token" >&2
  fi
fi

# ── Supabase Management API (optional) ───────────────────────────
if [ -n "${BWS_SUPABASE_SECRET_ID:-}" ]; then
  export SUPABASE_ACCESS_TOKEN=$(fetch_bws_secret "$BWS_SUPABASE_SECRET_ID")
  if [ -n "$SUPABASE_ACCESS_TOKEN" ]; then
    echo "Supabase access token loaded from BWS" >&2
  else
    echo "WARN: BWS_SUPABASE_SECRET_ID set but failed to fetch token" >&2
  fi
fi

# ── infra-brain (optional — degrades to cache/seed if absent) ────
# Fetch the audit access key from BWS by its stable UUID. The UUID is immutable and
# non-secret (useless without BWS_ACCESS_TOKEN), so defaulting the literal here is safe
# and keeps the fetch working off BWS_ACCESS_TOKEN alone — no fragile env propagation.
# Prefer the stable UUID over by-name: the secret's name is a mutable human label that
# will be renamed and silently break a by-name lookup. (Supersedes the earlier by-name
# approach / infra-brain lesson #273.)
export INFRABRAIN_BASE_URL="${INFRABRAIN_BASE_URL:-https://infra-brain.devonwatkins.com}"
export INFRABRAIN_ACCESS_KEY=$(fetch_bws_secret "${BWS_INFRABRAIN_SECRET_ID:-45eb083f-4b05-4251-924d-b46700e5a643}")
if [ -n "$INFRABRAIN_ACCESS_KEY" ]; then
  echo "infra-brain access key loaded from BWS" >&2
else
  echo "WARN: infra-brain access key not found in BWS — audit tool will degrade to cache/seed" >&2
fi

# ── app-brain (repo+branch resolution for app-conformance handoffs) ────
# app-brain has its OWN MCP_ACCESS_KEY (distinct from infra-brain's); its BWS secret UUID
# is the default, overridable via BWS_APPBRAIN_SECRET_ID.
export APPBRAIN_BASE_URL="${APPBRAIN_BASE_URL:-https://app-brain.devonwatkins.com}"
export APPBRAIN_ACCESS_KEY=$(fetch_bws_secret "${BWS_APPBRAIN_SECRET_ID:-68733abe-682a-4597-b88f-b4750189a56a}")

exec node "$SCRIPT_DIR/dist/index.js"
