#!/usr/bin/env bash
# Load BWS_ACCESS_TOKEN from the macOS login Keychain — never from a plaintext file.
#
# Source this (don't execute it) at the top of any script that calls `bws`:
#     source "$(dirname "${BASH_SOURCE[0]}")/bws-token.sh"
#
# Keychain item: service 'Claude', account 'BWS_ACCESS_TOKEN_INFRA_DRIFT'
# (mirrors the BWS_ACCESS_TOKEN_INFRAOPS / BWS_ACCESS_TOKEN_VPS_BACKUP pattern).
# Create/update it with:
#     security add-generic-password -U -s Claude -a BWS_ACCESS_TOKEN_INFRA_DRIFT \
#         -T /usr/bin/security -w
#
# Idempotent: respects an already-set BWS_ACCESS_TOKEN (e.g. an ad-hoc override).

if [ -z "${BWS_ACCESS_TOKEN:-}" ]; then
    BWS_ACCESS_TOKEN="$(/usr/bin/security find-generic-password \
        -s 'Claude' -a 'BWS_ACCESS_TOKEN_INFRA_DRIFT' -w 2>/dev/null || true)"
    export BWS_ACCESS_TOKEN
fi

if [ -z "${BWS_ACCESS_TOKEN:-}" ]; then
    echo "FATAL: BWS_ACCESS_TOKEN not found in Keychain" \
         "(service=Claude, account=BWS_ACCESS_TOKEN_INFRA_DRIFT)." \
         "Add it with: security add-generic-password -U -s Claude" \
         "-a BWS_ACCESS_TOKEN_INFRA_DRIFT -T /usr/bin/security -w" >&2
    return 1 2>/dev/null || exit 1
fi
