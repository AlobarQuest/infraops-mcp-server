#!/usr/bin/env python3
"""Consumer-mapping sweep for the WS-0.7 rotation targets.

Fingerprint-matches candidate credential values found on this machine (and in
BWS / Coolify) against the sha256[:8] prefixes recorded in
~/docs/security-audit/2026-07-02-codex-leak-rotation-targets.md.

SECURITY: values are hashed in-process and NEVER printed, logged, or written.
Output is location names + sha256[:8] prefixes only.
"""

import glob
import hashlib
import json
import os

import re
import subprocess

import urllib.request

HOME = os.path.expanduser("~")

# The 5 live leaked creds (sha256 prefix -> label), from the rotation-targets doc.
TARGETS = {
    "26058655": "github-classic-PAT-1 (repo,workflow,read:org,...)",
    "2d53ed7a": "github-classic-PAT-2 (repo,workflow,delete:packages,...)",
    "64b11252": "github-fine-grained-PAT",
    "57543baa": "openrouter-generic-key (= BWS 9661da8f)",
    "cb3a0415": "openai-project-key",
}

TOKEN_RE = re.compile(
    r"(ghp_[A-Za-z0-9]{30,}"
    r"|github_pat_[A-Za-z0-9_]{30,}"
    r"|gho_[A-Za-z0-9]{30,}"
    r"|sk-or-v1-[a-f0-9]{40,}"
    r"|sk-proj-[A-Za-z0-9_\-]{30,}[A-Za-z0-9]"
    r"|sk-ant-[A-Za-z0-9_\-]{30,}"
    r"|sk-[A-Za-z0-9_\-]{30,}[A-Za-z0-9])"
)

matches = {}   # sha8 -> list of locations
candidates = 0  # total token-shaped values inspected


def inspect(location: str, value: str) -> None:
    global candidates
    value = value.strip()
    if not value or len(value) < 20:
        return
    candidates += 1
    sha8 = hashlib.sha256(value.encode()).hexdigest()[:8]
    if sha8 in TARGETS:
        matches.setdefault(sha8, []).append(location)


def inspect_text(location: str, text: str) -> None:
    for m in TOKEN_RE.finditer(text):
        inspect(f"{location} (token-shaped)", m.group(1))


def run(cmd, timeout=15, env=None, input_=None):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           env=env, input=input_)
        return r.stdout
    except Exception:
        return ""


def section(name):
    print(f"--- {name}", flush=True)


# 1. gh CLI current token (keeper — expect NO match)
section("gh CLI token")
tok = run(["gh", "auth", "token"]).strip()
if tok:
    inspect("gh-cli-current-token", tok)

# 2. Shell config files
section("shell files")
for f in [".zshrc", ".zshenv", ".zprofile", ".bashrc", ".bash_profile", ".profile"]:
    p = os.path.join(HOME, f)
    if os.path.isfile(p):
        try:
            inspect_text(f"~/{f}", open(p, errors="ignore").read())
        except Exception:
            pass

# 3. ~/.config env-ish files (small files only)
section("~/.config env files")
for p in glob.glob(os.path.join(HOME, ".config", "**", "*"), recursive=True):
    if not os.path.isfile(p) or os.path.getsize(p) > 200_000:
        continue
    base = os.path.basename(p).lower()
    if base.startswith("env") or base.endswith((".env", ".toml", ".yml", ".yaml", ".json", ".sh")) or "env" in base:
        try:
            inspect_text(p.replace(HOME, "~"), open(p, errors="ignore").read())
        except Exception:
            pass

# 4. LaunchAgents plists
section("LaunchAgents")
for p in glob.glob(os.path.join(HOME, "Library", "LaunchAgents", "*.plist")):
    try:
        inspect_text(p.replace(HOME, "~"), open(p, errors="ignore").read())
    except Exception:
        pass

# 5. git credential stores
section("git credentials")
for f in [".git-credentials", ".config/gh/hosts.yml"]:
    p = os.path.join(HOME, f)
    if os.path.isfile(p):
        try:
            inspect_text(f"~/{f}", open(p, errors="ignore").read())
        except Exception:
            pass

# 6. Keychain: metadata scan -> fetch only credential-looking generic passwords
section("Keychain (login)")
meta = run(["security", "dump-keychain"], timeout=30)
svc_acct = re.findall(r'"svce"<blob>="([^"]+)"|"acct"<blob>="([^"]+)"', meta)
# reconstruct (service, account) pairs per item block
items = []
for block in meta.split("keychain: ")[1:]:
    svc = re.search(r'"svce"<blob>="([^"]+)"', block)
    acct = re.search(r'"acct"<blob>="([^"]+)"', block)
    if svc and acct:
        items.append((svc.group(1), acct.group(1)))
seen = set()
KEY_HINT = re.compile(r"github|openai|openrouter|token|pat\b|api|key|secret|claude|bws", re.I)
fetch_failures = []
for svc, acct in items:
    if (svc, acct) in seen:
        continue
    seen.add((svc, acct))
    if not (KEY_HINT.search(svc) or KEY_HINT.search(acct)):
        continue
    val = run(["security", "find-generic-password", "-s", svc, "-a", acct, "-w"], timeout=6).strip()
    if val:
        inspect(f"keychain:{svc}/{acct}", val)
        inspect_text(f"keychain:{svc}/{acct}", val)
    else:
        fetch_failures.append(f"{svc}/{acct}")
print(f"    keychain items scanned={len(seen)}, candidate-fetched-empty-or-denied={len(fetch_failures)}")
for f in fetch_failures:
    print(f"    UNFETCHED: {f}")

# 7. BWS: every secret value (hashed in-process)
section("BWS secrets")
bws_token = run(["security", "find-generic-password", "-s", "Claude",
                 "-a", "BWS_ACCESS_TOKEN_INFRA_DRIFT", "-w"], timeout=6).strip()
if bws_token:
    env = dict(os.environ, BWS_ACCESS_TOKEN=bws_token)
    out = run(["bws", "secret", "list", "--output", "json"], timeout=60, env=env)
    try:
        secrets = json.loads(out)
        for s in secrets:
            inspect(f"bws:{s['id']} ({s.get('key','?')})", s.get("value", ""))
            inspect_text(f"bws:{s['id']} ({s.get('key','?')})", s.get("value", ""))
        print(f"    bws secrets scanned={len(secrets)}")
    except Exception as e:
        print(f"    BWS list parse failed: {e}")
else:
    print("    BWS token not available from Keychain")

# 8. Coolify env vars (prod + dev), via API directly (values hashed in-process)
section("Coolify envs")


def coolify_scan(label, base, token):
    if not token:
        print(f"    {label}: no token")
        return
    def get(path):
        req = urllib.request.Request(base + "/api/v1" + path,
                                     headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode())
        except Exception:
            return None
    n_envs = 0
    for kind in ("applications", "services"):
        resources = get(f"/{kind}") or []
        for res in resources:
            uuid = res.get("uuid")
            if not uuid:
                continue
            envs = get(f"/{kind}/{uuid}/envs") or []
            for e in envs:
                for field in ("value", "real_value"):
                    v = e.get(field)
                    if isinstance(v, str) and v:
                        n_envs += 1
                        inspect(f"coolify[{label}]:{res.get('name',uuid)}/{e.get('key','?')}", v)
    print(f"    {label}: env values scanned={n_envs}")


def bws_get(uuid, env):
    out = run(["bws", "secret", "get", uuid, "--output", "json"], timeout=30, env=env)
    try:
        return json.loads(out).get("value", "")
    except Exception:
        return ""


if bws_token:
    env = dict(os.environ, BWS_ACCESS_TOKEN=bws_token)
    coolify_scan("prod", "http://coolify-1.devonwatkins.com",
                 bws_get("bbd71f41-b7df-4ae9-8fdb-b41501447308", env))
    coolify_scan("dev", "http://192.168.139.217:8000",
                 bws_get("8a2e1e10-d67b-4382-bbf3-b4150178e2a8", env))

# 9. Current process env
section("process env")
for k, v in os.environ.items():
    inspect(f"env:{k}", v)
    inspect_text(f"env:{k}", v)

# ── Report ──
print()
print("=" * 60)
print(f"RESULT — {candidates} candidate values inspected")
for sha8, label in TARGETS.items():
    locs = matches.get(sha8, [])
    print(f"\n[{sha8}] {label}")
    if locs:
        for loc in sorted(set(locs)):
            print(f"  CONSUMER: {loc}")
    else:
        print("  no consumer found on scanned surfaces")
