#!/bin/bash
# InfraOps MCP Server launcher
# Fetches secrets from BWS at startup so they never live in config files.
#
# Required env vars (set in .claude.json):
#   COOLIFY_BASE_URL            - Your Coolify instance URL
#   BWS_COOLIFY_SECRET_ID       - BWS secret ID for the Coolify API token
#
# Optional env vars:
#   BWS_HETZNER_SECRET_ID       - BWS secret ID for the Hetzner Cloud API token
#   BWS_SSH_PASSPHRASE_SECRET_ID - BWS secret ID for the SSH key passphrase
#   VPS_HOST                    - VPS IP address (default: 178.156.247.239)
#   VPS_USER                    - SSH user (default: root)
#   VPS_SSH_KEY_PATH            - Path to SSH private key (default: ~/.ssh/hetzner_ed25519)
#   NAMECHEAP_USE_SANDBOX       - "true" for sandbox, "false" for production (default: "true")
#
# Namecheap credentials are fetched from BWS by name (no env vars needed):
#   Sandbox: BWS_NAMECHEAP_SANDBOX_API_USER_SECRET_ID, BWS_NAMECHEAP_SANDBOX_API_KEY_SECRET_ID
#   Production: BWS_NAMECHEAP_PROD_API_USER_SECRET_ID, BWS_NAMECHEAP_PROD_API_KEY_SECRET_ID

set -euo pipefail

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

# Helper: fetch a BWS secret by name (key), returns empty string if not found
fetch_bws_secret_by_name() {
  local secret_name="$1"
  if [ -z "$secret_name" ]; then
    echo ""
    return
  fi
  bws secret list --output json 2>/dev/null | python3 -c "
import sys, json
secrets = json.load(sys.stdin)
for s in secrets:
    if s.get('key') == '${secret_name}':
        print(s['value'])
        sys.exit(0)
print('')
" 2>/dev/null || echo ""
}

# ── Coolify (required) ──────────────────────────────────────────────
export COOLIFY_API_TOKEN=$(fetch_bws_secret "${BWS_COOLIFY_SECRET_ID:-}")

if [ -z "$COOLIFY_API_TOKEN" ]; then
  echo "ERROR: Failed to fetch Coolify API token from BWS (secret ID: ${BWS_COOLIFY_SECRET_ID:-not set})" >&2
  exit 1
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

# Pick the right BWS secret names based on environment
if [ "${NAMECHEAP_USE_SANDBOX}" = "true" ]; then
  NC_USER_BWS_NAME="BWS_NAMECHEAP_SANDBOX_API_USER_SECRET_ID"
  NC_KEY_BWS_NAME="BWS_NAMECHEAP_SANDBOX_API_KEY_SECRET_ID"
  NC_ENV_LABEL="sandbox"
else
  NC_USER_BWS_NAME="BWS_NAMECHEAP_PROD_API_USER_SECRET_ID"
  NC_KEY_BWS_NAME="BWS_NAMECHEAP_PROD_API_KEY_SECRET_ID"
  NC_ENV_LABEL="production"
fi

export NAMECHEAP_API_USER=$(fetch_bws_secret_by_name "$NC_USER_BWS_NAME")
if [ -n "$NAMECHEAP_API_USER" ]; then
  echo "Namecheap API user loaded from BWS (${NC_ENV_LABEL})" >&2
fi

export NAMECHEAP_API_KEY=$(fetch_bws_secret_by_name "$NC_KEY_BWS_NAME")
if [ -n "$NAMECHEAP_API_KEY" ]; then
  echo "Namecheap API key loaded from BWS (${NC_ENV_LABEL})" >&2
fi

# Proxy bearer token for namecheap-proxy.devonwatkins.com
export NAMECHEAP_PROXY_TOKEN=$(fetch_bws_secret_by_name "NAMECHEAP_PROXY_BEARER_TOKEN")
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

exec node "$SCRIPT_DIR/dist/index.js"
