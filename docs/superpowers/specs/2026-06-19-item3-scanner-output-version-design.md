# Item #3 — scanner output-version assertion (design)

**Date:** 2026-06-19
**Repo / lane:** infraops-mcp-server (mutate lane) — owner of `scan-parser.ts` and the security-drift runner.
**Parent:** `security-standards/docs/2026-06-19-item3-scanner-output-version-infraops-handoff.md` (action item #3 in the governance realignment review). Adjacent to prong 2 (`…-prong2-…`, already merged to `main`).

## Problem

infraops `scan-parser.ts` parses `security-scan.sh`'s stdout by an **implicit contract** (the `LINE` regex + `extractTarget`). If a `make install` ships a scanner whose output shape changed, the parser silently matches nothing → the 3am drift job produces **zero findings** and nothing tells you the pipeline broke.

security-standards has already made the contract explicit: `scripts/security-scan.sh` now carries a machine-readable marker `# SCANNER_OUTPUT_VERSION=1` (a bash comment, NOT emitted to stdout) inside an `OUTPUT CONTRACT` block. **Version 1 == the current parser.** This task makes infraops read that marker from the **deployed** scanner and refuse to run on a version it wasn't written for.

## The reconcile-safety constraint (why the handoff's first recommendation was wrong)

The handoff originally suggested injecting a skew finding via `extraFindings` and letting the run proceed. That is **unsafe**: `runSecurityDrift` (runner.ts:91-98) POSTs the FULL current finding set every run, and change-manager's reconcile resolves any open item _absent_ from that sync (the source-scoped-reconcile invariant). On a real skew, `parseScan` yields empty/garbage → the sync would post only the skew finding → **reconcile would falsely resolve every real open security item.** That is the silent-zero-findings failure in a new costume.

Therefore: **on skew, the run must NOT reach `postSync` at all.** (security-standards is correcting the handoff to match.)

## Approach — preflight gate, abort-with-alert

Add a version gate in the CLI **before** the parse/classify/sync pipeline. On skew (or a missing/unreadable marker), the run alerts and aborts without ever calling `runSecurityDrift` — reconcile-safe (no `postSync` → no false-resolve) AND observable (urgent email, not just a crash in the 3am log).

```
main():
  p = securityPaths()
  selfCheckFindings = runSelfCheck(...)          # unchanged; trustworthy even on scanner skew
  skew = scannerVersionGate(p.scanPath, EXPECTED_SCANNER_OUTPUT_VERSION)   # NEW
  if skew:                                        # version != expected, or marker missing/unreadable
      # ABORT-WITH-ALERT — do NOT parse, do NOT postSync
      urgents = buildEscalations([skew, ...selfCheckFindings] classified, now).filter(urgent)
      sendUrgentEmail(urgents, {...})            # direct email; reuses existing notify config
      write abort digest to reportDir (if set)
      exit non-zero
  else:                                           # version OK → today's behavior, unchanged
      runSecurityDrift({ scanStdout: captureScan(p.scanPath), ..., extraFindings: selfCheckFindings }, deps)
```

### Why include the self-check urgents in the abort email

The abort skips `postSync`, so this cycle's _trustworthy_ self-check urgents (state-perms, audit-log tamper, control-plane drift, and prong 2's `runner_integrity`) would otherwise not surface at all until the next run. They are valid regardless of scanner skew, so the abort email carries them alongside the skew finding — nothing trustworthy is silently delayed by a scanner problem. (The scan-derived findings are withheld precisely because they cannot be trusted.)

### Always-alert on abort (no diff gate)

A broken scanner is a pipeline-down condition; the abort email fires every run while skewed (no baseline-diff "only new" gate). A skewed scanner should keep nagging until reconciled via `make install`. This is the fail-loud posture; the operator stops it by deploying the matching scanner.

### Reading the DEPLOYED scanner, not the source

The parser parses the **deployed** scanner's output, so the **deployed** scanner's version is what must match the parser. (Prong 2 separately enforces deployed == blessed source.) The two checks partition cleanly:

- deployed=1, source=2 → prong 2 fires `runner_integrity` (deploy drift); version gate is silent (the v1 parser correctly parses the still-deployed v1 scanner).
- deployed=2, expected=1 → version gate fires `scanner.output_version_skew` (parser can't trust v2 output); prong 2 may be silent if deployed==source.
  So item #3 catches the case prong 2 cannot: a bumped-and-deployed scanner whose parser wasn't updated.

## Components

One new file + a taxonomy entry + a CLI gate. The pure logic is isolated for unit-testing; only thin wiring lives in `main()`.

### 1. `src/security-drift/scanner-version.ts` (NEW)

Keeps `scan-parser.ts` pure (string→findings, no fs). This file owns the file-read + the gate decision.

```ts
export const EXPECTED_SCANNER_OUTPUT_VERSION = 1;

/** Read `# SCANNER_OUTPUT_VERSION=N` from the deployed scanner file. null if absent/unreadable/non-numeric. */
export function readScannerOutputVersion(scanPath: string): number | null { … }
//   regex: /^#\s*SCANNER_OUTPUT_VERSION=(\d+)\s*$/m  (first match; multiline)
//   reads scanPath as utf8; any read error → null (fail-loud handled by the gate)

/** Returns a skew Finding when the deployed scanner's version != expected (or marker missing); else null. */
export function scannerVersionGate(scanPath: string, expected: number): Finding | null { … }
//   const v = readScannerOutputVersion(scanPath)
//   if v === expected → return null
//   else → return a Finding LITERAL (scan-parser.ts has no shared `fail` helper; that one is private to self-check.ts):
//          { severity: "FAIL", check: "scanner.output_version_skew", target: scanPath,
//            detail: `deployed scanner output version ${v ?? "missing/unreadable"} != parser-expected ${expected} — `
//                  + `parser cannot be trusted; run aborted. Reconcile with: cd ~/Projects/security-standards && make install` }
```

### 2. `src/security-drift/taxonomy.ts`

Add `"scanner.output_version_skew"` to `URGENT_KEYS` (tiers URGENT and bypasses the false-positive filter at taxonomy.ts:109 — deny-by-default, same as prong 2's keys).

### 3. `src/cli/security-drift-cli.ts`

Insert the preflight gate between `runSelfCheck(...)` and `captureScan/runSecurityDrift`. On a non-null gate result: classify `[skew, ...selfCheckFindings]` (reusing `classify` + `buildEscalations`), filter urgent, `sendUrgentEmail(...)` with the existing notify config, write an abort digest to `reportDir` if set, and exit non-zero — without calling `runSecurityDrift`. On null: proceed exactly as today.

## Error handling / edge cases

- Marker absent, file unreadable, or marker present but non-numeric → `readScannerOutputVersion` returns `null` → gate returns a skew Finding → abort. (Fail-loud / deny-by-default.)
- `EXPECTED_SCANNER_OUTPUT_VERSION` is the single source of truth on the infraops side; it is bumped in the SAME PR that updates the parser when the line shape or a detail form changes (mirroring the marker bump in security-standards).
- The email-send itself failing does not change the abort: the run still aborts (no `postSync`) and exits non-zero; the digest is still written. (Same posture as the existing runner, where a failed `sendUrgent` doesn't fabricate success.)

## Testing — infraops suite

`tests/security-drift-scanner-version.test.ts` (NEW):

- `readScannerOutputVersion`: returns 1 for a file containing the marker (amid other lines); null when the marker is absent; null when the file does not exist; null when the value is non-numeric; picks the first marker if duplicated.
- `scannerVersionGate`: returns null when deployed == expected; returns a `scanner.output_version_skew` Finding (target = scanPath) when deployed != expected; returns a skew Finding when the marker is missing (null). Use a temp file + the real `EXPECTED_SCANNER_OUTPUT_VERSION`/explicit expected arg.

`tests/security-drift-taxonomy.test.ts` (extend):

- `scanner.output_version_skew` classifies URGENT and bypasses the FP filter (deliberate `fpExtra` substring match proving the bypass — same pattern as prong 2's key).

The CLI gate wiring (the abort branch in `main()`) is type-checked + exercised through the gate/escalation helpers; the repo does not unit-test `main()`, consistent with existing patterns. The behavior-bearing logic (gate decision, finding content) is fully covered by the unit tests above.

## Build / deploy / sequencing

- **Tracked-dist invariant:** every commit changing `src/` rebuilds and `git add dist/` wholesale (the runtime runs `dist/`, not `src/`).
- **Deploy is a separate, operator-run step (Devon's).** The marker is not yet deployed (deployed scanner currently lacks it; `cmp` shows deployed != source). Reconciling — for prong 2's byte-check, this item's marker, AND item #4's source-header — is ONE `cd ~/Projects/security-standards && make install`, batched after item #4's scanner edit lands, ideally after prong 2 has stabilized.
- **infraops code-merge timing:** to avoid stacking a `scanner.output_version_skew` URGENT on top of prong 2's `runner_integrity` during the pre-deploy interim, land this item's infraops code with or just after that `make install`, so its first live run already sees the marker. Both interim alerts are truthful and self-clear at the deploy; this is signal-hygiene, not correctness.

## Acceptance criteria (from the handoff)

1. Deployed scanner at `SCANNER_OUTPUT_VERSION=1` and `EXPECTED_…=1` → run behaves exactly as today (gate returns null; no new finding). ✅
2. Deployed marker ≠ expected (or missing) → emits an URGENT `scanner.output_version_skew` and does NOT report a normal "0 findings" success — here, aborts before `postSync`, so it also cannot false-resolve open items. ✅
3. Unit-tested in the infraops suite (wrong/absent marker). ✅

## Out of scope

- The optional "emit a PASS line in-stream" alternative from the handoff (we use the file-comment marker; no further security-standards change needed).
- Any change to `runSecurityDrift`'s internals — it stays the trusted-parse path, untouched.
- The `make install` deploy itself (operator action) and item #4.
