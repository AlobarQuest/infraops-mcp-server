# Prong 2 — source-verified runner integrity (design)

**Date:** 2026-06-19
**Repo / lane:** infraops-mcp-server (mutate lane) — owner of the security-drift self-check.
**Parent:** `security-standards/docs/2026-06-19-prong2-selfcheck-runner-integrity-handoff.md`,
which is prong 2 of action item #1 ("make `make install` reconcile the Check-13 tamper baseline")
in `security-standards/docs/2026-06-19-governance-realignment-review.md`.

## Problem

`make install` (security-standards) redeploys `~/.claude/bin/security-scan.sh`. That path is
gitignored in the `~/.claude` control-plane repo (`.gitignore` un-ignores `/hooks/` but not
`/bin/`), so it never trips Check 13 — prong 1 does not cover it. Instead it trips the
security-drift **self-check, check #3** (`src/security-drift/self-check.ts:79-95`): every file in
`integrityFiles` is sha256'd and compared to a recorded hash in the 0600 `hashFile`; a mismatch
emits `selfcheck.runner_integrity`, which `taxonomy.ts` tiers URGENT. The check then rewrites the
recorded hash every run, so it is **one-shot + self-healing**: it fires once per deploy and clears
on the next run.

Cheap, but it is still a control-plane URGENT raised by a _legitimate_ action. That trains the
operator to reflex-dismiss a control-plane URGENT — the exact alert fatigue the governance review
calls the one fatal-but-cheap wound. Goal: **zero alerts on a legit deploy; a real out-of-band
change still alerts.**

## Threat model (decided)

This check serves **drift / staleness (operator error)**: catch when the deployed scanner is not
the blessed source-of-truth — a hand-edit of `~/.claude/bin/`, a half-failed deploy, or a forgotten
redeploy. It explicitly does **not** attempt to defend against a same-uid local attacker who can
edit both the deployed copy and the source copy (and any 0600 store): no on-host mechanism —
today's hash store, a deploy receipt, or this design — durably defends against that; it needs an
off-host or cryptographically-signed root, which is out of scope. Given that scope, coupling the
check to the security-standards working-tree source is not a weakness — asserting
`deployed == blessed source` _is_ the drift check.

## Approach — Option C: source-verified, per-file policy

Split check #3's integrity files into two policies instead of one uniform "hash vs last run" loop.

| Policy                                    | Files                                                        | Rule                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source-verified**                       | the scanner: deployed `scanPath` vs blessed `scanSourcePath` | byte-compare deployed content to blessed-source content. Stateless — no hash store.                                                                                         |
| **Change-tracked** (unchanged from today) | `autoFixAllowlistFile`, `fpAllowlistFile`                    | sha256 vs recorded hash in `hashFile`; fail on change; record new hash. These have no source-of-truth repo, so their semantics must not be weakened (handoff criterion #3). |

**Validity of byte-compare:** `make install` deploys the scanner with `shutil.copyfile(src, dst)`
then `os.chmod` (`security-standards/src/security_scan/governance/deploy.py:30-31`) — a verbatim
content copy; chmod does not alter bytes read by `readFileSync`. So `deployed == source` holds
exactly in the steady state right after a legit `make install`. (Prong 1's `reconcile_control_plane`
already uses the same `src.read_bytes() != dst.read_bytes()` comparison at `deploy.py:132`.)

### Scanner outcomes

| Condition                                | Result                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deployed file unreadable                 | `continue` — not deployed yet, nothing to check (same as today's `readFileSync` catch)                                                                    |
| blessed source unreadable / unresolvable | emit `selfcheck.runner_source_unresolved` URGENT; detail names the source path tried. **Does not** silently pass (deny-by-default, handoff criterion #4). |
| `deployed != source` (bytes differ)      | emit `selfcheck.runner_integrity` URGENT; detail: "deployed scanner does not match blessed source `<sourcePath>` — investigate tamper or stale deploy"    |
| `deployed == source`                     | silent                                                                                                                                                    |

The "can't verify" case gets a **distinct key** (`selfcheck.runner_source_unresolved`) rather than
reusing `runner_integrity`, so the operator can tell "fix my environment — the source tree is
unreachable" apart from "the deployed scanner does not match blessed — investigate." Both tier
URGENT.

## Components / code touch points

Four source files + the existing self-check test file.

### 1. `src/security-drift/paths.ts`

Add to `SecurityPaths` and `securityPaths()`:

```ts
scanSourcePath: process.env.SECURITY_SCAN_SOURCE_PATH
  ?? path.join(home, "Projects", "security-standards", "scripts", "security-scan.sh"),
```

Env-overridable for hermetic tests and for relocation of the repo. No runtime governance-map
parsing — that is over-coupling for a single path. (If item #3's `SCANNER_OUTPUT_VERSION` work
later wants the same path resolved, it can read this field.)

### 2. `src/security-drift/self-check.ts`

- Extend `SelfCheckConfig`:
  ```ts
  sourceVerifiedFiles: {
    deployed: string;
    source: string;
  }
  [];
  // integrityFiles stays — now only the change-tracked set
  ```
- Add a source-verify block (before or after the existing hash loop). For each pair:
  - read `deployed`; on failure `continue`.
  - read `source`; on failure push `selfcheck.runner_source_unresolved` for `deployed` and continue.
  - if `!deployedBuf.equals(sourceBuf)` push `selfcheck.runner_integrity` for `deployed` with the
    "does not match blessed source" detail.
- Leave the `integrityFiles` hash loop (lines 80-95) **exactly as-is** — it now receives only the
  two allowlist files.

### 3. `src/cli/security-drift-cli.ts`

Rewire the `runSelfCheck({...})` call (currently lines 64-71):

```ts
sourceVerifiedFiles: [{ deployed: p.scanPath, source: p.scanSourcePath }],
integrityFiles: [p.autoFixAllowlistFile, p.fpAllowlistFile],
```

### 4. `src/security-drift/taxonomy.ts`

- Add `"selfcheck.runner_source_unresolved"` to `URGENT_KEYS`.
- Add a one-line entry to the summary/labels map mirroring `selfcheck.runner_integrity`
  (e.g. "Deployed scanner could not be verified against blessed source").

## Testing — `tests/security-drift-self-check.test.ts` (extend)

Hermetic via `SECURITY_SCAN_SOURCE_PATH` + temp files. New cases:

1. **deployed == source → no finding** (the legit-deploy steady state; the core acceptance).
2. **deployed != source → `selfcheck.runner_integrity`** (out-of-band edit / stale deploy).
3. **source missing → `selfcheck.runner_source_unresolved`**, and the run does NOT silently pass.
4. **deployed missing → no finding** (not deployed yet).
5. **Regression: allowlist files keep change-since-last-run** — an `integrityFiles` entry whose
   content changes still yields `selfcheck.runner_integrity` and records the new hash; proves the
   change-tracked policy is untouched (criterion #3).

A taxonomy test asserting `selfcheck.runner_source_unresolved` tiers URGENT can live in
`tests/security-drift-taxonomy.test.ts` if that file already covers `URGENT_KEYS` membership;
otherwise assert it in the self-check test via the classifier.

## Build / commit invariant

`dist/` is tracked and the 3am job runs `dist/`, not `src/`. Every commit that changes these
`src/` files MUST `npm run build` and `git add dist/` in the same commit — a green vitest run does
NOT prove `dist/` is current.

## Acceptance criteria (from the handoff)

1. Legit deploy is silent — case 1. ✅
2. Out-of-band change still alerts — case 2. ✅
3. Other `integrityFiles` unaffected — case 5. ✅
4. Fail loud, not open (unresolvable source → emit) — case 3 + distinct key. ✅
5. Unit-tested in the infraops suite — cases 1-5. ✅

## Out of scope

- Defending against a same-uid local attacker editing both deployed and source (needs off-host /
  signed root).
- Item #3 (`SCANNER_OUTPUT_VERSION` parser-skew guard) — adjacent, same seam, but a separate
  change. This design only resolves the source path in a way #3 can reuse.
- Any security-standards-side change. Option C is pure-infraops by construction (the reason it was
  recommended over the reconcile-command / deploy-receipt options).
