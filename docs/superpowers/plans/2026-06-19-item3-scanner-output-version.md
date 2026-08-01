# Item #3 — Scanner Output-Version Assertion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3am drift job refuse to run (fail loud) when the deployed `security-scan.sh`'s output-contract version does not match the version `scan-parser.ts` was written for, instead of silently parsing nothing.

**Architecture:** A preflight gate in the CLI reads the `# SCANNER_OUTPUT_VERSION=N` marker from the deployed scanner and compares it to an infraops-side `EXPECTED_SCANNER_OUTPUT_VERSION` constant. On skew (or a missing/unreadable marker) the run sends a direct URGENT email (the skew finding + this run's trustworthy self-check urgents) and exits non-zero **without** calling `runSecurityDrift` — so `postSync` never runs and reconcile cannot false-resolve open items. On match, behavior is exactly as today.

**Tech Stack:** TypeScript (Node 18+), vitest, MCP server compiled to a git-tracked `dist/`.

## Global Constraints

- **Reconcile-safety (the whole point):** on skew the run MUST NOT reach `runSecurityDrift`/`postSync`. `runSecurityDrift` POSTs the full current finding set every run and CM reconcile resolves anything absent from it; posting a partial/garbage set would false-resolve real open items.
- **Fail loud / deny-by-default:** a missing, unreadable, or non-numeric marker counts as skew → abort+alert. Never silently continue.
- **Read the DEPLOYED scanner** (`p.scanPath`), not the source — the parser parses the deployed scanner's output. (Prong 2 separately enforces deployed == source.)
- **The abort email carries the skew finding AND this run's trustworthy self-check urgents** (self-check is valid regardless of scanner skew). The scan-derived findings are withheld (untrusted).
- **Tracked-dist invariant:** the runtime runs `dist/`, not `src/`. Every commit that changes `src/` runs `npm run build` and stages dist with `git add dist/` **wholesale** (do not enumerate individual dist files — that left stale `.d.ts`/`.map` siblings in prong 2). `git status` must be clean after the commit.
- **Branch:** all work lands on `item3-scanner-output-version` (already checked out). Do NOT commit to `main`. **Do NOT stage or touch `CLAUDE.md`** — it has an unrelated uncommitted change from a parallel session; `git add` only the files each task names.

---

## File Structure

- `src/security-drift/scanner-version.ts` — NEW. Owns the `EXPECTED_SCANNER_OUTPUT_VERSION` constant, the marker file-read, and the gate decision. Keeps `scan-parser.ts` pure (no fs). (Task 1)
- `src/security-drift/taxonomy.ts` — add `scanner.output_version_skew` to `URGENT_KEYS`. (Task 2)
- `src/cli/security-drift-cli.ts` — insert the preflight gate + abort-with-alert branch. (Task 3)
- `tests/security-drift-scanner-version.test.ts` — NEW, unit tests for the reader + gate. (Task 1)
- `tests/security-drift-taxonomy.test.ts` — extend with the new-key routing test. (Task 2)

---

### Task 1: `scanner-version.ts` — the marker reader + gate

**Files:**

- Create: `src/security-drift/scanner-version.ts`
- Test: `tests/security-drift-scanner-version.test.ts`

**Interfaces:**

- Consumes: `Finding` from `./scan-parser.js`.
- Produces: `EXPECTED_SCANNER_OUTPUT_VERSION: number` (= 1); `readScannerOutputVersion(scanPath: string): number | null`; `scannerVersionGate(scanPath: string, expected: number): Finding | null`. Task 3 (the CLI) imports `scannerVersionGate` + `EXPECTED_SCANNER_OUTPUT_VERSION`. Task 2 routes the `scanner.output_version_skew` check key this produces.

- [ ] **Step 1: Write the failing tests**

Create `tests/security-drift-scanner-version.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readScannerOutputVersion,
  scannerVersionGate,
  EXPECTED_SCANNER_OUTPUT_VERSION,
} from '../src/security-drift/scanner-version.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-scanver-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeScanner(body: string): string {
  const p = path.join(dir, 'security-scan.sh');
  fs.writeFileSync(p, body);
  return p;
}

describe('readScannerOutputVersion', () => {
  it('extracts the version from the marker amid other lines', () => {
    const p = writeScanner(
      '#!/bin/bash\n# OUTPUT CONTRACT ...\n# SCANNER_OUTPUT_VERSION=1\necho hi\n',
    );
    expect(readScannerOutputVersion(p)).toBe(1);
  });
  it('returns null when the marker is absent', () => {
    expect(readScannerOutputVersion(writeScanner('#!/bin/bash\necho hi\n'))).toBeNull();
  });
  it('returns null when the file does not exist', () => {
    expect(readScannerOutputVersion(path.join(dir, 'nope.sh'))).toBeNull();
  });
  it('picks the first marker when duplicated', () => {
    expect(
      readScannerOutputVersion(
        writeScanner('# SCANNER_OUTPUT_VERSION=2\n# SCANNER_OUTPUT_VERSION=3\n'),
      ),
    ).toBe(2);
  });
});

describe('scannerVersionGate', () => {
  it('returns null when deployed version == expected', () => {
    expect(scannerVersionGate(writeScanner('# SCANNER_OUTPUT_VERSION=1\n'), 1)).toBeNull();
  });
  it('returns a skew Finding when deployed != expected', () => {
    const f = scannerVersionGate(writeScanner('# SCANNER_OUTPUT_VERSION=2\n'), 1);
    expect(f?.check).toBe('scanner.output_version_skew');
    expect(f?.severity).toBe('FAIL');
    expect(f?.target).toContain('security-scan.sh');
  });
  it('returns a skew Finding when the marker is missing (fail loud)', () => {
    expect(scannerVersionGate(writeScanner('#!/bin/bash\necho hi\n'), 1)?.check).toBe(
      'scanner.output_version_skew',
    );
  });
  it('pins EXPECTED_SCANNER_OUTPUT_VERSION to the current contract (1)', () => {
    expect(EXPECTED_SCANNER_OUTPUT_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/security-drift-scanner-version.test.ts`
Expected: FAIL — module `../src/security-drift/scanner-version.js` does not exist yet (import error).

- [ ] **Step 3: Create `src/security-drift/scanner-version.ts`**

```ts
// Asserts the DEPLOYED security-scan.sh was written against the output contract this
// parser understands. The marker `# SCANNER_OUTPUT_VERSION=N` is a bash comment in the
// scanner (NOT emitted to stdout); we read it from the deployed file and refuse to parse
// a contract we weren't written for. See scan-parser.ts for what version 1 means.

import * as fs from 'node:fs';
import type { Finding } from './scan-parser.js';

/** The scanner output-contract version scan-parser.ts was written against. Bump in the
 *  SAME PR that changes the LINE shape or a detail form in scan-parser.ts. */
export const EXPECTED_SCANNER_OUTPUT_VERSION = 1;

const MARKER = /^#\s*SCANNER_OUTPUT_VERSION=(\d+)\s*$/m;

/** Read `# SCANNER_OUTPUT_VERSION=N` from the deployed scanner file. Returns null if the
 *  file is unreadable, the marker is absent, or the value is non-numeric. */
export function readScannerOutputVersion(scanPath: string): number | null {
  let text: string;
  try {
    text = fs.readFileSync(scanPath, 'utf8');
  } catch {
    return null;
  }
  const m = text.match(MARKER);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

/** Returns a skew Finding when the deployed scanner's output version != expected (or the
 *  marker is missing/unreadable); else null. Deny-by-default: anything we cannot positively
 *  verify as matching is a skew (fail loud). */
export function scannerVersionGate(scanPath: string, expected: number): Finding | null {
  const v = readScannerOutputVersion(scanPath);
  if (v === expected) return null;
  return {
    severity: 'FAIL',
    check: 'scanner.output_version_skew',
    target: scanPath,
    detail:
      `deployed scanner output version ${v ?? 'missing/unreadable'} != parser-expected ${expected} — ` +
      `parser cannot be trusted; run aborted. Reconcile with: cd ~/Projects/security-standards && make install`,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/security-drift-scanner-version.test.ts`
Expected: PASS (all 9 cases).

- [ ] **Step 5: Build and commit (src + test + dist wholesale)**

```bash
npm run build
git add src/security-drift/scanner-version.ts tests/security-drift-scanner-version.test.ts dist/
git commit -m "feat(security-drift): scanner output-version marker reader + gate

Reads the deployed scanner's # SCANNER_OUTPUT_VERSION=N marker and returns a
scanner.output_version_skew Finding when it != the parser-expected version (or
is missing/unreadable). Pure-ish module (fs read only) kept out of scan-parser.ts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: build exit 0; `git status` clean after commit.

---

### Task 2: Taxonomy — route `scanner.output_version_skew` as URGENT

**Files:**

- Modify: `src/security-drift/taxonomy.ts:44-69` (the `URGENT_KEYS` set)
- Test: `tests/security-drift-taxonomy.test.ts`

**Interfaces:**

- Consumes: existing `classify(f, opts)` + the `f()` test factory.
- Produces: `URGENT_KEYS` now contains `"scanner.output_version_skew"`. Task 3 classifies the skew finding and relies on this routing (URGENT + FP-filter-immune).

- [ ] **Step 1: Write the failing test**

Add inside `describe("classify", …)` in `tests/security-drift-taxonomy.test.ts`. The `fpExtra: ["security-scan"]` substring matches the target path, so without `URGENT_KEYS` membership taxonomy.ts:109 would drop it to `null` — a true red→green for the FP-bypass (deny-by-default).

```ts
it('URGENTs a scanner output-version skew and bypasses the FP filter (deny-by-default)', () => {
  const c = classify(
    f({
      check: 'scanner.output_version_skew',
      target: '/Users/x/.claude/bin/security-scan.sh',
      detail:
        'deployed scanner output version 2 != parser-expected 1 — run aborted. Reconcile with: ... make install',
    }),
    { autoFixAllowlist: [], fpExtra: ['security-scan'] },
  );
  expect(c?.tier).toBe('URGENT');
  expect(c && 'manual' in c.remediation).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/security-drift-taxonomy.test.ts -t "scanner output-version skew"`
Expected: FAIL — `classify(...)` returns `null` (FP-dropped via `fpExtra`), so `c?.tier` is `undefined`.

- [ ] **Step 3: Add the key to `URGENT_KEYS`**

In `src/security-drift/taxonomy.ts`, add the entry to the `URGENT_KEYS` set, next to the other self-check/control-plane integrity keys (after `"selfcheck.runner_source_unresolved",`):

```ts
  "selfcheck.runner_source_unresolved",
  "scanner.output_version_skew",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/security-drift-taxonomy.test.ts -t "scanner output-version skew"`
Expected: PASS.

- [ ] **Step 5: Build and commit (src + test + dist wholesale)**

```bash
npm run build
git add src/security-drift/taxonomy.ts tests/security-drift-taxonomy.test.ts dist/
git commit -m "feat(security-drift): route scanner.output_version_skew as URGENT

URGENT_KEYS membership tiers it URGENT and bypasses the false-positive filter
(taxonomy.ts:109), so a scanner-version skew can never be silently dropped.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: build exit 0; `git status` clean after commit.

---

### Task 3: CLI preflight gate — abort-with-alert on skew

**Files:**

- Modify: `src/cli/security-drift-cli.ts` — imports (lines 12-16 region) + insert the gate between the `runSelfCheck(...)` call (ends line 71) and the `runSecurityDrift(...)` call (begins line 73)
- Test: full suite (`npx vitest run`) + `npm run build` (the repo does not unit-test `main()`; the behavior-bearing gate logic is unit-tested in Task 1)

**Interfaces:**

- Consumes: `scannerVersionGate` + `EXPECTED_SCANNER_OUTPUT_VERSION` (Task 1); `classify` (taxonomy); `buildEscalations` + `ClassifiedFinding` (emit); the existing `sendUrgentEmail`, `readList`, `securityPaths`, `runSelfCheck` already imported/defined in this file; `p.autoFixAllowlistFile` / `p.fpAllowlistFile` from `securityPaths()`.
- Produces: on skew, an aborted run (no `runSecurityDrift`, no `postSync`), a direct urgent email, an abort digest, and a non-zero exit.

- [ ] **Step 1: Add imports**

In `src/cli/security-drift-cli.ts`, add to the existing import block (alongside the other `../security-drift/*` imports near lines 13-16):

```ts
import { classify } from '../security-drift/taxonomy.js';
import { buildEscalations, type ClassifiedFinding } from '../security-drift/emit.js';
import {
  scannerVersionGate,
  EXPECTED_SCANNER_OUTPUT_VERSION,
} from '../security-drift/scanner-version.js';
```

- [ ] **Step 2: Insert the preflight gate**

In `main()`, immediately AFTER the `const selfCheckFindings = runSelfCheck({ … });` block (ends at line 71) and BEFORE `const result = await runSecurityDrift(` (line 73), insert:

```ts
// --- Preflight: refuse to run on a scanner whose output contract this parser was not
// written for. On skew we MUST NOT reach runSecurityDrift's postSync — it posts the full
// current set and CM reconcile would false-resolve every open item against a garbage parse.
// Abort with a direct urgent email carrying the skew + this run's trustworthy self-check urgents.
const skew = scannerVersionGate(p.scanPath, EXPECTED_SCANNER_OUTPUT_VERSION);
if (skew) {
  const classified: ClassifiedFinding[] = [];
  for (const finding of [skew, ...selfCheckFindings]) {
    const classification = classify(finding, {
      autoFixAllowlist: readList(p.autoFixAllowlistFile),
      fpExtra: readList(p.fpAllowlistFile),
    });
    if (classification) classified.push({ finding, classification });
  }
  const { escalations } = buildEscalations(classified, now);
  const urgent = escalations.filter((e) => e.urgent);
  const emailed = await sendUrgentEmail(urgent, {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.INFRADRIFT_EMAIL_FROM ?? 'infra@devonwatkins.com',
    to: process.env.INFRADRIFT_EMAIL_TO ?? 'devon.watkins@gmail.com',
  });
  const digest =
    `# Security drift ${now.slice(0, 10)} — ABORTED (scanner output-version skew)\n\n` +
    `🚨 ${skew.detail}\n\n` +
    `Run aborted before parse/sync (reconcile-safe: open items untouched). ` +
    `${urgent.length} urgent item(s), emailed=${emailed}.\n`;
  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, `${now.slice(0, 10)}.security.md`), digest, 'utf8');
  }
  process.stdout.write(digest + '\n');
  process.stdout.write(
    `\nsecurity-drift: ABORTED scanner_version_skew urgent=${urgent.length} emailed=${emailed}\n`,
  );
  process.exit(1);
}
```

(Leave the existing `runSecurityDrift(...)` call and everything after it unchanged — that is the version-OK path.)

- [ ] **Step 3: Build to verify the wiring type-checks**

Run: `npm run build`
Expected: exit 0. (Catches any import-name or type mismatch — e.g. `ClassifiedFinding`, `buildEscalations` signature.)

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS — whole suite green, including Tasks 1-2. No existing test exercises `main()`, so this confirms no regression from the new imports/branch.

- [ ] **Step 5: Build and commit (src + dist wholesale)**

```bash
npm run build
git add src/cli/security-drift-cli.ts dist/
git commit -m "feat(security-drift): preflight scanner-version gate, abort-with-alert on skew

Before parse/sync, assert the deployed scanner's SCANNER_OUTPUT_VERSION matches
EXPECTED_SCANNER_OUTPUT_VERSION. On skew: email the skew + this run's trustworthy
self-check urgents directly, write an abort digest, exit non-zero, and skip
runSecurityDrift entirely — no postSync, so reconcile cannot false-resolve open
items. Version-OK path is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: build exit 0; `git status` clean after commit.

---

## Acceptance criteria mapping (from the handoff)

1. Deployed `=1` and `EXPECTED=1` → gate returns null → run behaves exactly as today. → Task 1 (`scannerVersionGate == null`) + Task 3 (OK path unchanged). ✅
2. Deployed ≠ expected or missing → URGENT `scanner.output_version_skew`, no normal "0 findings" success → here aborts before `postSync` (reconcile-safe). → Task 1 (gate returns Finding) + Task 2 (URGENT routing) + Task 3 (abort-with-alert, no `runSecurityDrift`). ✅
3. Unit-tested in the infraops suite (wrong/absent marker). → Task 1 tests + Task 2 routing test. ✅

## Out of scope (do not build)

- Any change to `runSecurityDrift` internals (stays the trusted-parse path).
- The `make install` deploy of the marker (operator action) + item #4's source header.
- The handoff's optional in-stream `PASS`-line alternative (we use the file-comment marker).
