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
#   BWS_NAMECHEAP_API_USER_SECRET_ID - BWS secret ID for Namecheap API username
#   BWS_NAMECHEAP_API_KEY_SECRET_ID  - BWS secret ID for Namecheap API key
#   NAMECHEAP_CLIENT_IP         - Whitelisted IP for Namecheap API (default: VPS IP / 178.156.247.239)
#   NAMECHEAP_USE_SANDBOX       - "true" for sandbox, "false" for production (default: "true")

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
if [ -n "${BWS_NAMECHEAP_API_USER_SECRET_ID:-}" ]; then
  export NAMECHEAP_API_USER=$(fetch_bws_secret "$BWS_NAMECHEAP_API_USER_SECRET_ID")
  if [ -n "$NAMECHEAP_API_USER" ]; then
    echo "Namecheap API user loaded from BWS" >&2
  else
    echo "WARN: BWS_NAMECHEAP_API_USER_SECRET_ID set but failed to fetch" >&2
  fi
fi

if [ -n "${BWS_NAMECHEAP_API_KEY_SECRET_ID:-}" ]; then
  export NAMECHEAP_API_KEY=$(fetch_bws_secret "$BWS_NAMECHEAP_API_KEY_SECRET_ID")
  if [ -n "$NAMECHEAP_API_KEY" ]; then
    echo "Namecheap API key loaded from BWS" >&2
  else
    echo "WARN: BWS_NAMECHEAP_API_KEY_SECRET_ID set but failed to fetch" >&2
  fi
fi

# Default Namecheap client IP to VPS IP if not explicitly set
export NAMECHEAP_CLIENT_IP="${NAMECHEAP_CLIENT_IP:-${VPS_HOST:-178.156.247.239}}"

# Default to sandbox mode for safety
export NAMECHEAP_USE_SANDBOX="${NAMECHEAP_USE_SANDBOX:-true}"

if [ -n "${NAMECHEAP_API_USER:-}" ] && [ -n "${NAMECHEAP_API_KEY:-}" ]; then
  echo "Namecheap tools enabled (env: ${NAMECHEAP_USE_SANDBOX}=sandbox)" >&2
fi

exec node "$SCRIPT_DIR/dist/index.js"
