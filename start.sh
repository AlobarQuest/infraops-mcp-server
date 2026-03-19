#!/bin/bash
# InfraOps MCP Server launcher
# Fetches the Coolify API token from BWS at startup so it never lives in config files.
#
# Required env vars (set in .claude.json):
#   COOLIFY_BASE_URL        - Your Coolify instance URL
#   BWS_COOLIFY_SECRET_ID   - The BWS secret ID containing the Coolify API token
#
# Optional:
#   BWS_ACCESS_TOKEN        - BWS service account token (if not using machine auth)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Fetch the Coolify API token from BWS
export COOLIFY_API_TOKEN=$(bws secret get "$BWS_COOLIFY_SECRET_ID" --output json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])")

if [ -z "$COOLIFY_API_TOKEN" ]; then
  echo "ERROR: Failed to fetch Coolify API token from BWS (secret ID: $BWS_COOLIFY_SECRET_ID)" >&2
  exit 1
fi

exec node "$SCRIPT_DIR/dist/index.js"
