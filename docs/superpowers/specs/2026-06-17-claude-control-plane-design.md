# Claude Control Plane — version-control + tamper-evidence for `~/.claude`

**Date:** 2026-06-17
**Status:** Design (approved)
**Author:** Devon + Claude

## Problem

Infraops manages how Devon's infrastructure is configured, scanned, and remediated.
But the layer that governs **whether Claude can touch that infrastructure at all** — the
Claude Code control plane — is almost entirely *loose* (not under version control, no
drift baseline, no rollback). An inventory on 2026-06-17 found that everything under
`~/.claude/` is unmanaged because `~/.claude` is not a git repo:

- **Instruction layer:** `~/.claude/CLAUDE.md` (the core security policy — session
  discipline, kill-chain checkpoints, deny policy, red-flag phrases), `RTK.md`.
- **Permission/config layer:** `settings.json` (the 13-pattern catastrophic deny list,
  hook wiring, `skipDangerousModePermissionPrompt: true`), `settings.local.json`, `.mcp.json`
  (the MCP server registry — `infraops` carries infra-mutation power).
- **Enforcement hooks (all 8, all fail-open):** `bws-write-guard.sh`, `bws-read-guard.sh`,
  `bws-scan-gate.sh`, `high-power-gate.sh`, `high-power-audit-log.sh`, `devon-plugins-guard.sh`,
  `session-start.sh`, `session-end.sh`.

Two compounding properties make this the real exposure:

1. **Fail-open + unmanaged = silent degradation.** Every hook fails open. A typo in
   `settings.json`, a one-character break in `bws-write-guard.sh`, or the
   `~/Projects/security-standards` dependency going missing (3 hooks lose teeth) silently
   removes protection — with no error, no rollback, and no review trail.
2. **The detector watches the control plane but has no baseline to diff against.**
   `~/.claude/bin/security-scan.sh` already checks *some* of this (hook registration,
   read-guard health, settings regressions), but with the files not in git there is no
   source-of-truth to diff or revert to.

The infra config is version-controlled + drift-detected + change-managed; the layer that
decides whether Claude can mutate that infra is not. This design closes that gap.

## Goal

**Tamper-evidence + rollback** for the control plane, reusing the existing security-drift →
change-manager pipeline rather than building new alerting. Auto-remediation ("self-heal") is
explicitly **out of v1 scope** — see Future Trajectory.

## Non-goals (v1)

- No general auto-heal / auto-restore. Detection + escalation only.
- No tracking of `skills/`, `agents/`, `agent-memory/` (a separate, larger question).
- No change to the `bin/` detectors' ownership — they stay owned + hash-verified by infraops.

## Approach: the directory *is* the repo

`git init` directly in `~/.claude`, with a **deny-by-default `.gitignore`** that tracks only an
explicit control-plane allow-list. Private remote at `AlobarQuest/claude-control-plane`.

Unlike the `security-scan.sh` source→deploy pattern, there is **no deploy indirection**: the
live files Claude actually reads *are* the tracked files. Therefore `git status` / `git diff`
in `~/.claude` **is** the tamper check — there is no source/deployed two-copy gap to reconcile.

### Why not a separate repo + installer / fold into security-standards
- **Separate repo + installer** (the `security-scan.sh` pattern) was rejected for the control
  plane: it re-introduces a deployed-vs-source gap, which is exactly the indirection that makes
  tamper-evidence harder (you'd hash-compare instead of `git diff`).
- **Fold into `security-standards`** was rejected: that repo is shareable standards/library code
  (the Python `security_scan` package); the control plane is machine-specific personal config.
  Different concerns, different audiences.

## What is tracked (allow-list)

The `.gitignore` ignores `/*` then un-ignores exactly:

| Path | Layer | Notes |
|------|-------|-------|
| `CLAUDE.md`, `RTK.md` | instruction | core security policy |
| `settings.json` | permission | **critical**: deny list, hook wiring, bypass flag |
| `settings.local.json` | permission | per-project allowlists; expected to be churny — kept anyway so a malicious allow-add is visible. Tracked but **not escalated** (WARN severity, dropped by taxonomy — see Tamper-evidence). Revisit if noise is unmanageable. |
| `.mcp.json` | config | MCP server registry |
| `hooks/` (excl. `*.bak*`) | enforcement | all 8 hook scripts |
| `statusline-command.sh` | misc | script Claude runs |
| `README.md` (new) | docs | documents repo purpose + tracked set + tamper mechanism |

**Excluded:**
- **`bin/` (gitignored):** `security-scan.sh` / `skills-security-scan.sh` are owned and
  hash-verified by infraops (`self-check.ts`). Tracking them here would re-create the
  two-owner problem just resolved in the infraops consolidation.
- **`*.bak*`** clutter (e.g. `settings.json.bak-*`, `.mcp.json.bak-*`, `hooks/*.bak-*`):
  ignored; git history replaces manual backups.
- **Generated / sensitive bulk:** `projects/` (416M session transcripts), `plugins/` (143M),
  `history.jsonl`, `audit/`, `file-history/`, caches, `tasks/`, `sessions/`, `.DS_Store`, etc.

### Secrets hygiene
Tracked files were verified to contain **no secret values** — only BWS secret *IDs*
(non-secret, stable references — explicitly allowed by the secure-way-of-working rules),
tool-name allowlists, and config (`AUTH_METHOD`, etc.). The deny-by-default `.gitignore`
prevents accidental capture of the sensitive bulk. Because `~/.claude` becomes a repo, the
existing `bws-scan-gate` Stop-hook will now also scan it (desirable); a `.security-scan-allow.toml`
will be added only if a tracked file produces a benign BLOCK finding.

## Tamper-evidence mechanism

Two layers, both reusing existing machinery:

1. **Passive (always-on):** the tracked files being the live files means `git -C ~/.claude
   status` shows any change to a control-plane file as uncommitted drift since the last
   reviewed commit.
2. **Active (the alarm) — one new check in `security-scan.sh` (infraops):** each run
   (daily 03:00 embedded + Mon 09:00 standalone) executes `git -C ~/.claude status --porcelain`
   over the tracked set. The tracked set splits into two escalation tiers to avoid alert fatigue:

   - **Critical set — escalates (FAIL):** `settings.json`, `hooks/`, `.mcp.json`, `CLAUDE.md`,
     `RTK.md`. Dirtiness here means the deny list, hook wiring, MCP registry, or core policy
     changed without being committed/reviewed — emit a FAIL finding into the **existing**
     security-drift → change-manager → Resend pipeline (no new alerting code).
   - **Churn set — surfaced, not escalated (WARN severity, dropped by taxonomy):** `settings.local.json`. It changes most
     sessions (new per-project allowances), so its drift is recorded at WARN severity and is
     **not** posted as a change-manager escalation — preventing daily flooding while keeping
     it in git history (so a malicious allow-add is still visible on review).

   This is the single new cross-repo edge: infraops' detector gains awareness of the
   `~/.claude` repo. (V2 option: also compare current `HEAD` to a recorded "last-reviewed"
   commit to catch reviewed-but-unexpected advances.)

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `~/.claude/.gitignore` | deny-by-default allow-list | — |
| `~/.claude/README.md` | document repo purpose + tracked set | — |
| `~/.claude` git repo + `AlobarQuest/claude-control-plane` remote | history, rollback, offsite backup | `gh` / `github_create_repo` |
| new check in `security-standards/scripts/security-scan.sh` | detect control-plane drift, emit finding | the `~/.claude` repo existing |
| existing security-drift pipeline | classify + escalate + email | unchanged |

## Bootstrap (one-time)

1. `git -C ~/.claude init`
2. Write `.gitignore` (deny-by-default) and `README.md`
3. `git add` the allow-list; verify nothing sensitive staged (`git status`, diff review)
4. Initial commit
5. Create private repo (`github_create_repo` → `AlobarQuest/claude-control-plane`), add remote, push
6. Add the control-plane-drift check to `security-standards/scripts/security-scan.sh`; redeploy via
   `security-standards/scripts/install-security-scan-launchd.sh`; confirm the self-check hash updates once (expected)

## Testing / verification

- `.gitignore` correctly excludes the sensitive bulk: `git status` shows ONLY the allow-list;
  `git ls-files | wc -l` is small and inspected.
- No secret-shaped values in tracked files (re-run the value scan).
- `bws-scan-gate` / `security-scan.sh` pass (exit 0, no BLOCK) with the repo present.
- The new drift check: dirty a tracked file in a scratch copy → check emits a finding;
  clean tree → no finding.
- infraops build + full test suite green after the `security-scan.sh` change.

## Future Trajectory (explicitly deferred)

Per Devon: build self-healing **incrementally, as specific drift patterns are discovered in
day-to-day use** — each as a narrow, per-pattern remediation under the same deny-by-default,
guarded discipline as infraops' existing autofix allowlist. Only **after a period of stability**
do we evaluate a **general auto-heal** (restore-known-good) feature. v1 ships detection +
escalation; nothing auto-reverts.

## Spec / plan home

This spec and its implementation plan live in `infraops-mcp-server/docs/superpowers/` (the repo
with the convention and the `security-scan.sh` check change). The git-init + `.gitignore` +
`README.md` work targets `~/.claude`.
