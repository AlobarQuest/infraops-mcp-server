# Prong 2 — Source-Verified Runner Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a legitimate scanner deploy silent to the security-drift self-check by asserting the deployed `~/.claude/bin/security-scan.sh` byte-matches its blessed source, while an out-of-band edit, a stale/forgotten deploy, or an unverifiable source still raise an URGENT.

**Architecture:** Split the self-check's check #3 into two per-file policies: a new *source-verified* policy (deployed artifact must byte-equal its blessed source — stateless) for the scanner, and the existing *change-tracked* policy (sha256 vs recorded hash) for the two allowlist files. A new distinct finding key `selfcheck.runner_source_unresolved` signals "can't verify" and is added to the taxonomy's `URGENT_KEYS` so it bypasses the false-positive filter (deny-by-default).

**Tech Stack:** TypeScript (Node 18+), vitest, MCP server compiled to tracked `dist/`.

## Global Constraints

- **Threat model:** this check serves drift/staleness (operator error), NOT a same-uid local attacker. Do not add machinery aimed at the latter — it is explicitly out of scope.
- **Deny-by-default / fail loud:** an unreadable or unresolvable blessed source must EMIT a finding, never silently pass (handoff criterion #4).
- **Do not weaken the change-tracked policy** for the two allowlist files (`security-autofix-allowlist.txt`, `security-fp-allowlist.txt`) — they keep "changed since last run → flag" (criterion #3).
- **Source path is env-overridable:** `SECURITY_SCAN_SOURCE_PATH` overrides the default `~/Projects/security-standards/scripts/security-scan.sh`. No runtime governance-map parsing.
- **Tracked `dist/` invariant:** `dist/` is committed and the 3am job runs `dist/`, not `src/`. A green vitest run does NOT prove `dist/` is current. Every task that changes `src/` MUST `npm run build` and `git add dist/` in the SAME commit.
- **Branch:** all work lands on `prong2-source-verified-runner-integrity` (already checked out). Do not commit to `main`.

---

## File Structure

- `src/security-drift/taxonomy.ts` — classification. Add the new URGENT key. (Task 1)
- `src/security-drift/self-check.ts` — the detector. Add `sourceVerifiedFiles` to `SelfCheckConfig` and the source-verify block; leave the change-tracked hash loop untouched. (Task 2)
- `src/security-drift/paths.ts` — path resolution. Add `scanSourcePath`. (Task 3)
- `src/cli/security-drift-cli.ts` — wiring. Pass `sourceVerifiedFiles` + the trimmed `integrityFiles` into `runSelfCheck`. (Task 3)
- `tests/security-drift-taxonomy.test.ts` — taxonomy test. (Task 1)
- `tests/security-drift-self-check.test.ts` — self-check tests + cfg() helper update + regression relabel. (Task 2)

---

### Task 1: Taxonomy — route the new "can't verify" key as URGENT

**Files:**
- Modify: `src/security-drift/taxonomy.ts:44-69` (the `URGENT_KEYS` set)
- Test: `tests/security-drift-taxonomy.test.ts`

**Interfaces:**
- Consumes: existing `classify(f: Finding, opts: ClassifyOptions): Classification | null` and the `f()` test factory in the test file.
- Produces: `URGENT_KEYS` now contains `"selfcheck.runner_source_unresolved"`. Task 2 emits findings with that `check` value and relies on this routing.

- [ ] **Step 1: Write the failing test**

Add this case inside the `describe("classify", …)` block in `tests/security-drift-taxonomy.test.ts` (e.g. after the `controlplane.unmanaged` case near line 68). The `fpExtra: ["security-standards"]` is essential: the detail contains that substring, so if the key were NOT in `URGENT_KEYS`, line 109's FP filter would drop it to `null`. This makes the test a true red→green for criterion #4 (without it, deny-by-default would return URGENT anyway and the test would pass vacuously).

```ts
  it("URGENTs an unverifiable deployed scanner and bypasses the FP filter (deny-by-default)", () => {
    const c = classify(
      f({
        check: "selfcheck.runner_source_unresolved",
        target: "/Users/x/.claude/bin/security-scan.sh",
        detail: "blessed source unreadable at /Users/x/Projects/security-standards/scripts/security-scan.sh — cannot verify deployed artifact",
      }),
      { autoFixAllowlist: [], fpExtra: ["security-standards"] },
    );
    expect(c?.tier).toBe("URGENT");
    expect(c && "manual" in c.remediation).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/security-drift-taxonomy.test.ts -t "unverifiable deployed scanner"`
Expected: FAIL — `classify(...)` returns `null` (FP-dropped via `fpExtra`), so `c?.tier` is `undefined`, not `"URGENT"`.

- [ ] **Step 3: Add the key to `URGENT_KEYS`**

In `src/security-drift/taxonomy.ts`, add the entry to the `URGENT_KEYS` set, next to the existing self-check keys (after line 60, `"selfcheck.runner_integrity",`):

```ts
  "selfcheck.runner_integrity",
  "selfcheck.runner_source_unresolved",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/security-drift-taxonomy.test.ts -t "unverifiable deployed scanner"`
Expected: PASS.

- [ ] **Step 5: Build and commit (src + test + dist together)**

```bash
npm run build
git add src/security-drift/taxonomy.ts tests/security-drift-taxonomy.test.ts dist/security-drift/taxonomy.js
git commit -m "feat(security-drift): route selfcheck.runner_source_unresolved as URGENT

Bypasses the false-positive filter (taxonomy.ts:109) so a 'cannot verify
deployed scanner' finding can never be silently dropped by an fpExtra match.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: `npm run build` exits 0; commit succeeds.

---

### Task 2: Self-check — source-verified integrity policy

**Files:**
- Modify: `src/security-drift/self-check.ts` — `SelfCheckConfig` interface (lines 15-23) and `runSelfCheck` (add a block before the existing check #3 at lines 79-95)
- Test: `tests/security-drift-self-check.test.ts` — `cfg()` helper (lines 11-21), new `describe` block, and relabel of the existing scanner test (lines 56-63)

**Interfaces:**
- Consumes: `URGENT_KEYS` membership of `selfcheck.runner_source_unresolved` from Task 1; the existing `fail(check, target, detail): Finding` helper (self-check.ts:47); `Finding` from `scan-parser.js`.
- Produces: `SelfCheckConfig` gains a required field `sourceVerifiedFiles: { deployed: string; source: string }[]`. Task 3 (the CLI) populates it. The source-verify block emits `selfcheck.runner_integrity` (deployed≠source) or `selfcheck.runner_source_unresolved` (source unreadable), targeting the deployed path.

- [ ] **Step 1: Write the failing tests + update the cfg() helper**

In `tests/security-drift-self-check.test.ts`:

(a) Add `sourceVerifiedFiles: []` to the `cfg()` default so existing tests still satisfy the (now-required) field. The helper becomes:

```ts
function cfg(over: Partial<SelfCheckConfig> = {}): SelfCheckConfig {
  return {
    stateFiles: [],
    auditLog: path.join(dir, "audit.jsonl"),
    hwmFile: path.join(dir, "hwm.json"),
    sourceVerifiedFiles: [],
    integrityFiles: [],
    hashFile: path.join(dir, "hashes.json"),
    now: "2026-06-15T03:00:00Z",
    ...over,
  };
}
```

(b) Relabel the existing scanner test (currently lines 56-63) so it documents the *change-tracked* (allowlist) policy it now exercises — the scanner has moved to the source-verified policy. Replace it with:

```ts
  it("change-tracked config (allowlist) seeds on first sight then flags on change", () => {
    const conf = path.join(dir, "security-fp-allowlist.txt");
    fs.writeFileSync(conf, "#original");
    expect(runSelfCheck(cfg({ integrityFiles: [conf] }))).toHaveLength(0); // seed
    fs.writeFileSync(conf, "#CHANGED");
    const findings = runSelfCheck(cfg({ integrityFiles: [conf] }));
    expect(findings.map((x) => x.check)).toContain("selfcheck.runner_integrity");
  });
```

(c) Add a new `describe` block (e.g. after the existing `describe("runSelfCheck", …)` closes, or nested before its closing brace) with the four source-verified cases:

```ts
describe("runSelfCheck — source-verified integrity", () => {
  function pair() {
    return {
      deployed: path.join(dir, "bin-security-scan.sh"),
      source: path.join(dir, "src-security-scan.sh"),
    };
  }

  it("is silent when the deployed scanner byte-matches its blessed source", () => {
    const { deployed, source } = pair();
    fs.writeFileSync(deployed, "#!/bin/bash\necho blessed\n");
    fs.writeFileSync(source, "#!/bin/bash\necho blessed\n");
    expect(runSelfCheck(cfg({ sourceVerifiedFiles: [{ deployed, source }] }))).toHaveLength(0);
  });

  it("flags runner_integrity when the deployed scanner differs from blessed source", () => {
    const { deployed, source } = pair();
    fs.writeFileSync(deployed, "#!/bin/bash\necho TAMPERED\n");
    fs.writeFileSync(source, "#!/bin/bash\necho blessed\n");
    const findings = runSelfCheck(cfg({ sourceVerifiedFiles: [{ deployed, source }] }));
    expect(findings.map((x) => x.check)).toContain("selfcheck.runner_integrity");
  });

  it("flags runner_source_unresolved when the blessed source is unreadable (fail loud, not open)", () => {
    const { deployed, source } = pair();
    fs.writeFileSync(deployed, "#!/bin/bash\necho blessed\n");
    // source intentionally not written → unreadable
    const findings = runSelfCheck(cfg({ sourceVerifiedFiles: [{ deployed, source }] }));
    expect(findings.map((x) => x.check)).toContain("selfcheck.runner_source_unresolved");
  });

  it("is silent when the deployed scanner does not exist yet (nothing to verify)", () => {
    const { deployed, source } = pair();
    fs.writeFileSync(source, "#!/bin/bash\necho blessed\n");
    // deployed intentionally not written
    expect(runSelfCheck(cfg({ sourceVerifiedFiles: [{ deployed, source }] }))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/security-drift-self-check.test.ts`
Expected: FAIL — TypeScript/compile error because `SelfCheckConfig` has no `sourceVerifiedFiles` field yet (the `cfg()` default and test bodies reference it), and `runSelfCheck` does not emit the new findings.

- [ ] **Step 3: Implement the source-verify policy in `self-check.ts`**

(a) Add the field to `SelfCheckConfig` (after `hwmFile`, before `integrityFiles`):

```ts
export interface SelfCheckConfig {
  stateFiles: string[]; // must be 0600 + owned
  auditLog: string;
  hwmFile: string; // 0600 store of the audit-log high-water size
  sourceVerifiedFiles: { deployed: string; source: string }[]; // deployed must byte-match blessed source
  integrityFiles: string[]; // hashed for change detection (no source-of-truth repo)
  hashFile: string; // 0600 store of recorded hashes
  now: string;
  getUid?: () => number;
}
```

(b) Insert this block in `runSelfCheck` immediately BEFORE the existing `// 3. runner / config integrity` comment (currently line 79). Renumber the existing one to `3b` in its comment for clarity.

```ts
  // 3a. source-verified integrity — a deployed artifact must byte-match its blessed
  // source-of-truth. Stateless (no hash store): the steady state right after a legit
  // `make install` (shutil.copyfile) is deployed == source. A mismatch means tamper or a
  // stale/forgotten deploy; an unreadable source means we cannot verify — emit, never
  // silently pass (deny-by-default).
  for (const { deployed, source } of cfg.sourceVerifiedFiles) {
    let deployedBuf: Buffer;
    try {
      deployedBuf = fs.readFileSync(deployed);
    } catch {
      continue; // not deployed yet — nothing to verify
    }
    let sourceBuf: Buffer;
    try {
      sourceBuf = fs.readFileSync(source);
    } catch {
      findings.push(fail("selfcheck.runner_source_unresolved", deployed, `blessed source unreadable at ${source} — cannot verify deployed artifact`));
      continue;
    }
    if (!deployedBuf.equals(sourceBuf)) {
      findings.push(fail("selfcheck.runner_integrity", deployed, `deployed scanner does not match blessed source ${source} — investigate tamper or stale deploy`));
    }
  }

```

Update the existing comment `// 3. runner / config integrity` to `// 3b. change-tracked integrity (config files with no source-of-truth repo)`. Leave the loop body (lines 80-95) unchanged.

Also update the top-of-file checklist comment (lines 6-8) to reflect the split:

```ts
//   3a. source integrity — deployed scanner must byte-match its blessed source
//   3b. change integrity — allowlist config files must not change unexpectedly
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/security-drift-self-check.test.ts`
Expected: PASS — all original cases plus the four new source-verified cases and the relabeled change-tracked case.

- [ ] **Step 5: Build and commit (src + test + dist together)**

```bash
npm run build
git add src/security-drift/self-check.ts tests/security-drift-self-check.test.ts dist/security-drift/self-check.js
git commit -m "feat(security-drift): source-verified integrity policy for the deployed scanner

Split self-check #3: the scanner is now verified by byte-equality against its
blessed source (silent on a legit deploy, URGENT on mismatch/unverifiable);
the allowlist files keep the change-since-last-run policy unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: `npm run build` exits 0; commit succeeds.

---

### Task 3: Wiring — resolve the source path and route it into the self-check

**Files:**
- Modify: `src/security-drift/paths.ts` — add `scanSourcePath` to `SecurityPaths` (lines 8-20) and `securityPaths()` (lines 28-40)
- Modify: `src/cli/security-drift-cli.ts:64-71` — the `runSelfCheck({...})` call
- Test: full suite (`npx vitest run`) + `npm run build` (type-check is the wiring's gate; the repo does not unit-test the CLI entrypoint or `paths.ts`, consistent with existing patterns)

**Interfaces:**
- Consumes: `SelfCheckConfig.sourceVerifiedFiles` from Task 2; `securityPaths()` returning a `SecurityPaths`.
- Produces: `SecurityPaths.scanSourcePath: string`. The CLI passes `sourceVerifiedFiles: [{ deployed: p.scanPath, source: p.scanSourcePath }]` and the trimmed `integrityFiles: [p.autoFixAllowlistFile, p.fpAllowlistFile]`.

- [ ] **Step 1: Add `scanSourcePath` to `paths.ts`**

In the `SecurityPaths` interface (after `scanPath: string;`):

```ts
  scanPath: string;
  scanSourcePath: string;
```

In the returned object of `securityPaths()` (after the `scanPath:` line):

```ts
    scanPath: process.env.SECURITY_SCAN_PATH ?? path.join(home, ".claude", "bin", "security-scan.sh"),
    scanSourcePath: process.env.SECURITY_SCAN_SOURCE_PATH ?? path.join(home, "Projects", "security-standards", "scripts", "security-scan.sh"),
```

- [ ] **Step 2: Rewire the `runSelfCheck` call in the CLI**

In `src/cli/security-drift-cli.ts`, replace the existing call (lines 64-71). The scanner moves out of `integrityFiles` into `sourceVerifiedFiles`; the two allowlist files remain in `integrityFiles`:

```ts
  const selfCheckFindings = runSelfCheck({
    stateFiles: [p.baselineFile, p.emitStateFile, p.rollbackLog],
    auditLog: p.auditLog,
    hwmFile: p.hwmFile,
    sourceVerifiedFiles: [{ deployed: p.scanPath, source: p.scanSourcePath }],
    integrityFiles: [p.autoFixAllowlistFile, p.fpAllowlistFile],
    hashFile: p.hashFile,
    now,
  });
```

(Note: any stale `scanPath` entry left in the existing `hashFile` from prior runs is harmless — the change-tracked loop only iterates the current `integrityFiles`, which no longer includes it.)

- [ ] **Step 3: Build to verify the wiring type-checks**

Run: `npm run build`
Expected: exits 0. A field-name typo (e.g. `sourceVerified` vs `sourceVerifiedFiles`) would fail here.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS — the whole suite is green, including Tasks 1-2 tests. Confirms no regression from the wiring.

- [ ] **Step 5: Build and commit (src + dist together)**

```bash
npm run build
git add src/security-drift/paths.ts src/cli/security-drift-cli.ts dist/security-drift/paths.js dist/cli/security-drift-cli.js
git commit -m "feat(security-drift): wire blessed-source path into the self-check

paths.ts resolves scanSourcePath (SECURITY_SCAN_SOURCE_PATH override, default
~/Projects/security-standards/scripts/security-scan.sh); the CLI routes the
deployed scanner through the source-verified policy and keeps the allowlist
files on the change-tracked policy.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: `npm run build` exits 0; commit succeeds.

---

## Acceptance criteria mapping (from the handoff)

1. Legit deploy is silent → Task 2, "byte-matches" case. ✅
2. Out-of-band change still alerts → Task 2, "differs from blessed source" case. ✅
3. Other `integrityFiles` unaffected → Task 2, relabeled "change-tracked config" regression case. ✅
4. Fail loud, not open → Task 2 "source unreadable" case + Task 1 URGENT_KEYS/FP-bypass test. ✅
5. Unit-tested in the infraops suite → Tasks 1-2. ✅

## Out of scope (do not build)

- Same-uid local-attacker defense (off-host/signed root).
- Item #3 `SCANNER_OUTPUT_VERSION` parser-skew guard (separate change; this only resolves the source path it can later reuse).
- Any security-standards-side change.
