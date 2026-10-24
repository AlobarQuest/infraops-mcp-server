#!/usr/bin/env python3
"""Copy every check from hosted Healthchecks.io to the self-hosted instance.

One-off migration tool (docs/superpowers/plans/2026-10-23-healthchecks-self-hosted-migration.md,
Task 1). Safe to re-run: each create sends `unique: ["name"]`, so an existing check comes back
unchanged (HTTP 200) instead of being duplicated.

SECURITY: API keys are read from BWS into memory and ping URLs are never printed. Output is one
line per check: name, created|existing, schedule or timeout, and grace.

Usage: hc-copy-checks.py --hosted-key-id <bws-uuid> --target-key-id <bws-uuid>
The BWS machine token comes from $BWS_ACCESS_TOKEN, or the Keychain item
Claude/BWS_ACCESS_TOKEN_VPS_BACKUP.
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.request

HOSTED_API = "https://healthchecks.io/api/v3/checks/"
TARGET_API = "https://healthcheck.alobar.net/api/v3/checks/"
# Cloudflare proxies the target and refuses default Python User-Agents (error code: 1010).
USER_AGENT = "hc-copy-checks/1 (+infraops-mcp-server)"


def to_payload(hosted: dict) -> dict:
    """The create request for the self-hosted copy of one hosted check."""
    payload = {
        "name": hosted["name"],
        "grace": hosted["grace"],
        "desc": hosted.get("desc", ""),
        "tags": hosted.get("tags", ""),
        "channels": "*",
        "unique": ["name"],
    }
    if hosted.get("schedule"):
        payload["schedule"] = hosted["schedule"]
        payload["tz"] = hosted["tz"]
    else:
        payload["timeout"] = hosted["timeout"]
    return payload


def bws_get(uuid: str, token: str) -> str:
    out = subprocess.run(
        ["bws", "secret", "get", uuid, "--output", "json", "--color", "no"],
        env=dict(os.environ, BWS_ACCESS_TOKEN=token), capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)["value"]


def request(method: str, url: str, key: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        url, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"X-Api-Key": key, "User-Agent": USER_AGENT, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.status, json.loads(resp.read())


def main() -> int:
    parser = argparse.ArgumentParser(description="Copy hosted Healthchecks.io checks to self-hosted.")
    parser.add_argument("--hosted-key-id", required=True)
    parser.add_argument("--target-key-id", required=True)
    args = parser.parse_args()

    token = os.environ.get("BWS_ACCESS_TOKEN") or subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-s", "Claude", "-a",
         "BWS_ACCESS_TOKEN_VPS_BACKUP", "-w"], capture_output=True, text=True, check=True,
    ).stdout.strip()
    hosted_key = bws_get(args.hosted_key_id, token)
    target_key = bws_get(args.target_key_id, token)

    _, listing = request("GET", HOSTED_API, hosted_key)
    checks = sorted(listing["checks"], key=lambda c: c["name"])
    for check in checks:
        payload = to_payload(check)
        status, _ = request("POST", TARGET_API, target_key, payload)
        outcome = {201: "created", 200: "existing"}.get(status, f"HTTP {status}")
        when = payload.get("schedule") and f"{payload['schedule']} {payload['tz']}" \
            or f"every {payload['timeout']}s"
        print(f"{payload['name']:<30} {outcome:<9} {when:<34} grace={payload['grace']}s")
    print(f"{len(checks)} hosted checks processed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
