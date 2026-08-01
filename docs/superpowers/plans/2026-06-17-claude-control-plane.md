# Claude Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the loose Claude Code control plane under git for tamper-evidence + rollback by git-init'ing `~/.claude`, and surface drift through the existing security-drift → change-manager pipeline.

**Architecture:** `~/.claude` becomes a git repo with a deny-by-default `.gitignore` tracking only the control-plane set — so the live files Claude reads ARE the tracked files and `git diff` is itself the tamper check. A new check in the infraops-owned `security-scan.sh` reports drift: critical-set changes escalate (FAIL → deny-by-default URGENT), `settings.local.json` churn is logged but dropped by `taxonomy.ts` (WARN → null).

**Tech Stack:** git, bash (security-scan.sh), TypeScript/vitest (security-drift taxonomy), `github_create_repo` MCP tool.

## Global Constraints

- **Deny-by-default `.gitignore`:** ignore `/*`, then un-ignore ONLY the explicit allow-list. Never commit the generated/sensitive bulk (`projects/`, `plugins/`, `audit/`, `history.jsonl`, caches).
- **No secret values tracked:** only BWS secret _IDs_, tool-name allowlists, and config. Verify before every commit in `~/.claude`.
- **`bin/` is excluded:** `security-scan.sh` / `skills-security-scan.sh` stay owned + hash-verified by infraops; never track them in the `~/.claude` repo.
- **`security-scan.sh` stays READ-ONLY:** Check 13 may only read (`git status`); it must never `git add`/`commit` or mutate anything.
- **No auto-heal in v1:** detection + escalation only.
- **Severity mapping is fixed by `emit`:** only `FAIL`/`WARN`/`PASS` exist. Critical drift = `FAIL`; expected churn = `WARN` + an explicit taxonomy drop.
- **Repo:** private `AlobarQuest/claude-control-plane`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: git-init `~/.claude` with deny-by-default `.gitignore` + README

**Files:**

- Create: `~/.claude/.gitignore`
- Create: `~/.claude/README.md`

**Interfaces:**

- Produces: a git repo at `~/.claude` whose tracked set is exactly the control-plane allow-list. Task 4's Check 13 depends on `~/.claude/.git` existing.

- [ ] **Step 1: Write `~/.claude/.gitignore`**

```gitignore
# ~/.claude control-plane repo — deny-by-default.
# Ignore EVERYTHING, then un-ignore ONLY the security-critical control-plane set.
# Never commit secrets or the generated bulk (projects/, plugins/, audit/, caches).
# See README.md for rationale + the full tracked set.
/*

# --- instruction layer ---
!/.gitignore
!/README.md
!/CLAUDE.md
!/RTK.md

# --- permission / config layer ---
!/settings.json
!/settings.local.json
!/.mcp.json
!/statusline-command.sh

# --- enforcement hooks (track scripts, ignore manual backups) ---
!/hooks/
hooks/*.bak*
```

- [ ] **Step 2: Write `~/.claude/README.md`**

```markdown
# Claude Control Plane (`~/.claude`)

This directory is a git repo (private remote `AlobarQuest/claude-control-plane`) that
version-controls the **security-critical Claude Code control plane** — the layer that
governs whether Claude may mutate infrastructure — for **tamper-evidence + rollback**.

## Tracked set (see `.gitignore`)

- `CLAUDE.md`, `RTK.md` — instruction layer (core security policy)
- `settings.json` — deny list, hook wiring, `skipDangerousModePermissionPrompt`
- `settings.local.json` — per-project permission allowlists (expected churn)
- `.mcp.json` — MCP server registry
- `hooks/` — the enforcement hooks (`*.bak*` excluded)
- `statusline-command.sh`

**Not tracked:** `bin/` (the security-scan detectors are owned + hash-verified by the
infraops-mcp-server repo), and all generated/sensitive content (`projects/`, `plugins/`,
`audit/`, `history.jsonl`, caches) — excluded deny-by-default.

## Tamper-evidence

Because the live files ARE the tracked files, `git -C ~/.claude status` shows any change
since the last reviewed commit. The infraops `security-scan.sh` "Check 13" reports drift:
critical-set changes escalate via the security-drift → change-manager pipeline;
`settings.local.json` churn is logged but not escalated.

## Rollback

`git -C ~/.claude diff` to inspect, `git -C ~/.claude checkout -- <file>` to revert a
tampered file to the last committed state.

Design: `infraops-mcp-server/docs/superpowers/specs/2026-06-17-claude-control-plane-design.md`
```

- [ ] **Step 3: Initialize the repo**

Run: `git -C ~/.claude init -b main`
Expected: `Initialized empty Git repository in /Users/devon/.claude/.git/`

- [ ] **Step 4: Verify the `.gitignore` exposes ONLY the allow-list**

Run: `git -C ~/.claude status --porcelain`
Expected: exactly these untracked entries (order may vary), and NOTHING else (no `projects/`, `plugins/`, `audit/`, `history.jsonl`, `.DS_Store`, `*.bak*`):

```
?? .gitignore
?? .mcp.json
?? CLAUDE.md
?? README.md
?? RTK.md
?? hooks/
?? settings.json
?? settings.local.json
?? statusline-command.sh
```

If any generated/sensitive path appears, STOP and fix `.gitignore` before continuing.

- [ ] **Step 5: Verify no secret VALUES are about to be committed**

Run:

```bash
git -C ~/.claude diff --no-index /dev/null /dev/null >/dev/null 2>&1
for f in settings.json settings.local.json .mcp.json statusline-command.sh; do
  grep -nE '0\.[0-9a-f]{36}\.|BWS_ACCESS_TOKEN[[:space:]]*[=:][[:space:]]*["'"'"']?0\.|-----BEGIN [A-Z ]*PRIVATE KEY-----' "$HOME/.claude/$f" 2>/dev/null \
    && echo "SECRET-SHAPED VALUE in $f — STOP" || true
done
echo "value scan done"
```

Expected: `value scan done` with no "SECRET-SHAPED VALUE" line. (BWS secret _IDs_ like `BWS_COOLIFY_SECRET_ID` are non-secret and fine; this scan only trips on actual token/key VALUES.)

- [ ] **Step 6: Stage and commit**

```bash
git -C ~/.claude add .gitignore README.md CLAUDE.md RTK.md settings.json settings.local.json .mcp.json statusline-command.sh hooks/
git -C ~/.claude status --porcelain
git -C ~/.claude commit -q -m "chore: init control-plane repo (tamper-evidence + rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected after add: all entries show `A` (added), none under `bin/`, no `*.bak*`.

- [ ] **Step 7: Verify a clean tree**

Run: `git -C ~/.claude status --porcelain && echo CLEAN`
Expected: `CLEAN` (no output before it). A subsequent change to any tracked file will now show as drift.

---

### Task 2: Create the private remote and push

**Files:** none (remote operation)

**Interfaces:**

- Consumes: the local repo from Task 1.
- Produces: offsite backup at `AlobarQuest/claude-control-plane`.

- [ ] **Step 1: Create the private GitHub repo**

Use the MCP tool `github_create_repo` with: `name: "claude-control-plane"`, `org/owner: "AlobarQuest"`, `private: true`, `description: "Version-controlled Claude Code control plane (~/.claude) — tamper-evidence + rollback"`.
Expected: repo created; clone URL `git@github.com:AlobarQuest/claude-control-plane.git`.

- [ ] **Step 2: Add the remote and push**

```bash
git -C ~/.claude remote add origin git@github.com:AlobarQuest/claude-control-plane.git
git -C ~/.claude push -u origin main
```

Expected: `branch 'main' set up to track 'origin/main'`; push succeeds.

- [ ] **Step 3: Verify the remote has only the allow-list**

Run: `git -C ~/.claude ls-tree -r --name-only origin/main`
Expected: only the tracked control-plane files (no `projects/`, `bin/`, `audit/`, etc.).

---

### Task 3: Route control-plane findings in `taxonomy.ts` (TDD)

**Files:**

- Modify: `/Users/devon/Projects/infraops-mcp-server/src/security-drift/taxonomy.ts`
- Test: `/Users/devon/Projects/infraops-mcp-server/tests/security-drift-taxonomy.test.ts`

**Interfaces:**

- Consumes: `classify(f: Finding, opts: ClassifyOptions): Classification | null` (existing).
- Produces: `controlplane.drift` + `controlplane.unmanaged` → `tier: "URGENT"`; `controlplane.local_churn` → `null` (dropped). Task 4 emits findings with these exact check keys.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("classify", ...)` block in `tests/security-drift-taxonomy.test.ts`:

```ts
it('URGENTs an uncommitted control-plane critical change (deny-by-default)', () => {
  const c = classify(
    f({
      check: 'controlplane.drift',
      target: 'settings.json',
      detail:
        'uncommitted/untracked control-plane change:  M settings.json (review + commit if intended)',
    }),
    { autoFixAllowlist: [] },
  );
  expect(c?.tier).toBe('URGENT');
  expect(c && 'manual' in c.remediation).toBe(true);
});

it('URGENTs an unmanaged control plane (no git repo)', () => {
  const c = classify(
    f({
      check: 'controlplane.unmanaged',
      target: '/Users/x/.claude',
      detail: '/Users/x/.claude is not a git repo',
    }),
    { autoFixAllowlist: [] },
  );
  expect(c?.tier).toBe('URGENT');
});

it('drops settings.local.json churn (logged in scan, never escalated)', () => {
  const c = classify(
    f({
      severity: 'WARN',
      check: 'controlplane.local_churn',
      target: 'settings.local.json',
      detail: 'settings.local.json changed since last commit (expected churn)',
    }),
    { autoFixAllowlist: [] },
  );
  expect(c).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/security-drift-taxonomy.test.ts`
Expected: the `local_churn` test FAILS (deny-by-default currently returns URGENT, not null). The two URGENT tests may already pass via deny-by-default — that is fine; the explicit mappings below make them intentional + titled.

- [ ] **Step 3: Add the explicit mappings in `taxonomy.ts`**

In `URGENT_KEYS`, add these two entries (after the `mcp.server_added` line, inside the `Set`):

```ts
  // control-plane tamper-evidence (~/.claude git repo):
  "controlplane.drift",
  "controlplane.unmanaged",
```

Immediately AFTER the `URGENT_KEYS` set definition, add the ignore set:

```ts
// Findings surfaced in the scan log but intentionally NOT escalated (expected churn).
const IGNORE_KEYS = new Set<string>(['controlplane.local_churn']);
```

In `SHORT_TITLES`, add:

```ts
  "controlplane.drift": "Control-plane file changed without review",
  "controlplane.unmanaged": "Control plane not under version control",
```

In `classify`, add the ignore short-circuit immediately after the existing `if (isFalsePositive(f, opts)) return null;` line:

```ts
if (IGNORE_KEYS.has(f.check)) return null;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/security-drift-taxonomy.test.ts`
Expected: PASS (all three new tests green, existing tests unaffected).

- [ ] **Step 5: Commit**

```bash
cd /Users/devon/Projects/infraops-mcp-server
git add src/security-drift/taxonomy.ts tests/security-drift-taxonomy.test.ts
git commit -q -m "feat(security-drift): route control-plane drift findings

controlplane.drift / controlplane.unmanaged -> URGENT (escalate);
controlplane.local_churn -> dropped (logged, never escalated).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add Check 13 (control-plane git drift) to `security-scan.sh`

**Files:**

- Modify: `/Users/devon/Projects/security-standards/scripts/security-scan.sh` (insert before the summary block at the end)

**Interfaces:**

- Consumes: the `~/.claude` git repo (Task 1), the `emit` function, the `have` helper.
- Produces: findings with check keys `controlplane.drift` (FAIL), `controlplane.local_churn` (WARN), `controlplane.clean` (PASS), `controlplane.unmanaged` (FAIL) — routed by Task 3.

- [ ] **Step 1: Insert Check 13**

In `security-standards/scripts/security-scan.sh`, immediately BEFORE the final summary block (the line `# ---------------------------------------------------------------------------` that precedes `echo "=== summary:`), insert:

```bash
# ---------------------------------------------------------------------------
# 13. Claude control-plane git drift (~/.claude tamper-evidence)
#     ~/.claude is a git repo tracking the control-plane set (hooks, settings,
#     .mcp.json, CLAUDE.md, RTK.md). An uncommitted/untracked change to the
#     CRITICAL set => FAIL (deny-by-default URGENT escalation). settings.local.json
#     is expected churn => WARN controlplane.local_churn, dropped by taxonomy
#     (logged, never escalated). READ-ONLY: never commits.
# ---------------------------------------------------------------------------
CP="$HOME/.claude"
if have git && [ -d "$CP/.git" ]; then
  crit="$(git -C "$CP" status --porcelain -- settings.json .mcp.json CLAUDE.md RTK.md hooks/ statusline-command.sh 2>/dev/null)"
  if [ -n "$crit" ]; then
    while IFS= read -r l; do
      [ -n "$l" ] && emit FAIL controlplane.drift "uncommitted/untracked control-plane change: ${l} (review + commit if intended)"
    done <<< "$crit"
  else
    emit PASS controlplane.clean "control-plane critical set matches HEAD"
  fi
  if [ -n "$(git -C "$CP" status --porcelain -- settings.local.json 2>/dev/null)" ]; then
    emit WARN controlplane.local_churn "settings.local.json changed since last commit (expected churn)"
  fi
else
  emit FAIL controlplane.unmanaged "$CP is not a git repo — control-plane tamper-evidence inactive (run: git -C $CP init)"
fi
```

- [ ] **Step 2: Positive check — clean tree reports PASS**

Run: `bash /Users/devon/Projects/security-standards/scripts/security-scan.sh 2>&1 | grep controlplane`
Expected (with `~/.claude` committed clean from Task 1): `PASS controlplane.clean   control-plane critical set matches HEAD` and NO `FAIL controlplane.drift` line.

- [ ] **Step 3: Negative check — dirtying a critical file reports FAIL (scratch, non-destructive)**

Run (uses a throwaway tracked file path, then reverts — does NOT leave drift):

```bash
cd /Users/devon/Projects/infraops-mcp-server
# simulate a critical-set change
printf '\n# scan-test marker\n' >> "$HOME/.claude/CLAUDE.md"
bash /Users/devon/Projects/security-standards/scripts/security-scan.sh 2>&1 | grep 'controlplane.drift' && echo "DETECTED" || echo "MISSED"
# revert the simulated change
git -C "$HOME/.claude" checkout -- CLAUDE.md
bash /Users/devon/Projects/security-standards/scripts/security-scan.sh 2>&1 | grep -q 'controlplane.clean' && echo "REVERTED-CLEAN"
```

Expected: a `FAIL controlplane.drift ... CLAUDE.md ...` line then `DETECTED`, and after revert `REVERTED-CLEAN`.

- [ ] **Step 4: Update infraops docs**

In `/Users/devon/Projects/infraops-mcp-server/CLAUDE.md`, in the Security-Drift Subsystem section, append to the modules description that `security-scan.sh` includes "Check 13: control-plane git drift (`~/.claude` tracked-file tamper-evidence) — critical-set changes escalate URGENT; `settings.local.json` churn is dropped by `taxonomy.ts`."

In `/Users/devon/Projects/infraops-mcp-server/scripts/README.md`, in the "Standalone weekly security scan" section's detector bullet, add "control-plane git drift (`~/.claude`)" to the parenthesized list of checks.

- [ ] **Step 5: Commit**

```bash
cd /Users/devon/Projects/infraops-mcp-server
git -C /Users/devon/Projects/security-standards add scripts/security-scan.sh && git add CLAUDE.md scripts/README.md
git commit -q -m "feat(security-scan): Check 13 — control-plane git drift detection

Reports ~/.claude tracked-file drift: critical set -> FAIL (URGENT),
settings.local.json -> WARN (dropped by taxonomy). Read-only; never commits.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Deploy, integrate, and verify end-to-end

**Files:** none (deploy + verification); uses `security-standards/scripts/install-security-scan-launchd.sh`.

**Interfaces:**

- Consumes: the committed `security-scan.sh` (Task 4) and taxonomy (Task 3).
- Produces: the updated detector deployed to `~/.claude/bin/`; a verified-green build.

- [ ] **Step 1: Deploy the updated detector**

Run: `bash /Users/devon/Projects/security-standards/scripts/install-security-scan-launchd.sh`
Expected: "Deployed scanners to /Users/devon/.claude/bin ... loaded com.devon.security-scan".

- [ ] **Step 2: Confirm deployed == repo source**

Run: `diff /Users/devon/Projects/security-standards/scripts/security-scan.sh ~/.claude/bin/security-scan.sh && echo IN-SYNC`
Expected: `IN-SYNC`.

- [ ] **Step 3: Note the expected one-time self-check URGENT**

The deployed `~/.claude/bin/security-scan.sh` hash changed, so the next security-drift run emits ONE `selfcheck.runner_integrity` URGENT ("scanner hash changed — verify intentional"), then records the new hash. This is expected per the spec's bootstrap step 6 — acknowledge it; do not treat it as a real finding.

- [ ] **Step 4: Build + full test suite**

Run: `cd /Users/devon/Projects/infraops-mcp-server && npm run build && npx vitest run`
Expected: build clean (`tsc`), all tests pass.

- [ ] **Step 5: Session-end scan gate is clean**

Run: `cd /Users/devon/Projects/infraops-mcp-server && PYTHONPATH="$HOME/Projects/security-standards/src" python3 -m security_scan.cli . --category security >/tmp/cp-scan.json 2>&1; echo "exit: $?"`
Expected: `exit: 0` and no BLOCK findings (the `~/.claude` repo addition introduces no committed secrets here).

- [ ] **Step 6: Confirm the control-plane repo itself is still clean**

Run: `git -C ~/.claude status --porcelain && echo CLEAN`
Expected: `CLEAN` (Task 4's negative check reverted its change; the deploy touched only `~/.claude/bin/`, which is gitignored).

---

## Self-Review

**Spec coverage:**

- git-init `~/.claude` + deny-by-default `.gitignore` → Task 1 ✓
- Tracked allow-list (incl. `bin/` exclusion, `*.bak*` exclusion) → Task 1 (`.gitignore`) ✓
- Private remote `AlobarQuest/claude-control-plane` → Task 2 ✓
- Secrets hygiene (no values; verify) → Task 1 Step 5; Task 5 Step 5 (scan gate) ✓
- Tamper-evidence: passive (`git status`) + active (Check 13 → pipeline) → Task 4 ✓
- Critical-vs-churn escalation tiers → Task 3 (taxonomy) + Task 4 (emit) ✓
- `security-scan.sh` stays read-only → Check 13 only reads; constraint stated ✓
- Self-check hash one-time URGENT on redeploy → Task 5 Step 3 ✓
- Docs (README in repo, infraops CLAUDE.md + scripts/README.md) → Task 1 Step 2, Task 4 Step 4 ✓
- Future auto-heal deferred → not implemented (correct) ✓

**Placeholder scan:** none — all code, paths, and commands are concrete.

**Type/key consistency:** check keys `controlplane.drift` / `controlplane.unmanaged` / `controlplane.local_churn` / `controlplane.clean` are identical across Task 3 (taxonomy + tests) and Task 4 (emit). `classify` / `Finding` / `ClassifyOptions` match the existing signatures read from source.
