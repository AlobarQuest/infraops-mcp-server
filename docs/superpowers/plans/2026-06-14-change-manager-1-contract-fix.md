# Change Manager — Plan 1: Escalation Contract Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `Escalation` carry its `instance` (`prod`/`dev`) and bump the remediation report `schema_version` to 2, so the downstream change manager knows which Coolify instance each escalation belongs to.

**Architecture:** `run-remediation.ts` already tracks `instance` on each `Tagged` item but drops it when building the `Escalation`. Add `instance` to the `Escalation` interface, thread the value through, and bump the report's `schema_version`. Pure type + data-threading change; no new modules.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest. Part of the existing `infraops-mcp-server` repo.

**Spec:** `docs/superpowers/specs/2026-06-14-change-manager-design.md` → "Contract fix (prerequisite)".

**Conventions (follow exactly):**

- Source imports use `.js` specifiers; tests live in `tests/`, import from `../src/...js`.
- Build: `npm run build`. Test: `npx vitest run`. Single file: `npx vitest run tests/NAME.test.ts`.
- `dist/` is **tracked** and run directly by launchd — a final task rebuilds and commits it.
- Commit after each task. Branch first off `main` (e.g. `feat/cm-contract-fix`).

---

## File Structure

| File                                  | Change                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/standards/remediation-report.ts` | Add `instance: string` to the `Escalation` interface; bump `schema_version` 1 → 2 in `buildRemediationReport`. |
| `src/standards/run-remediation.ts`    | Add `instance: t.instance` to each pushed `Escalation`.                                                        |
| `tests/run-remediation.test.ts`       | Assert escalations carry the correct `instance`.                                                               |
| `tests/remediation-report.test.ts`    | Add `instance` to `Escalation` fixtures; assert `schema_version === 2`.                                        |
| `dist/**`                             | Rebuilt + committed (final task).                                                                              |

---

## Task 1: Thread `instance` into `Escalation`

**Files:**

- Modify: `src/standards/remediation-report.ts` (the `Escalation` interface)
- Modify: `src/standards/run-remediation.ts` (the escalation builder)
- Test: `tests/run-remediation.test.ts`

- [ ] **Step 1: Add the failing assertion to the run-remediation test**

In `tests/run-remediation.test.ts`, find the test `"applies safe proposals and escalates questions"` and add, after the existing `expect(report.totals.escalated).toBe(1);` line:

```typescript
// contract v2: escalations carry their instance
expect(report.escalations[0].instance).toBe('prod');
```

(The `prop(...)` helper builds proposals audited under the `["prod"]` instance in that test, so the single escalation's `instance` must be `"prod"`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/run-remediation.test.ts`
Expected: FAIL — `report.escalations[0].instance` is `undefined` (the field isn't built yet). It may also be a type error once Step 3's interface lands; running now should show the runtime `undefined` mismatch.

- [ ] **Step 3: Add `instance` to the `Escalation` interface**

In `src/standards/remediation-report.ts`, change the `Escalation` interface to include `instance` (place it right after `proposal_id`):

```typescript
export interface Escalation {
  proposal_id: string;
  instance: string; // 'prod' | 'dev' — which Coolify instance this came from (contract v2)
  target: Proposal['target'];
  risk: string;
  kind: string;
  reasoning: string;
  plan: RemediationPlan;
  /** Why this was escalated rather than auto-applied (e.g. a verify gate held it). Absent for inherently-escalated items. */
  note?: string;
}
```

- [ ] **Step 4: Populate `instance` where escalations are built**

In `src/standards/run-remediation.ts`, find the `escalations.push({ ... })` block (inside the `for (const t of toEscalate)` loop) and add `instance: t.instance,` right after `proposal_id: t.proposal.id,`:

```typescript
escalations.push({
  proposal_id: t.proposal.id,
  instance: t.instance,
  target: t.proposal.target,
  risk: t.proposal.risk,
  kind: t.proposal.kind,
  reasoning: t.proposal.reasoning,
  plan,
  ...(t.note ? { note: t.note } : {}),
});
```

- [ ] **Step 5: Run the run-remediation test to verify it passes**

Run: `npx vitest run tests/run-remediation.test.ts`
Expected: PASS (all cases, including the new `instance` assertion).

- [ ] **Step 6: Fix the now-broken remediation-report test fixtures (type error)**

Adding a required `instance` field makes the `Escalation` fixtures in `tests/remediation-report.test.ts` fail to type-check. In that file, find the `escalations` const (and any inline `Escalation` objects, e.g. the `held` fixture in the "Auto-fix held" test) and add `instance: "prod",` to each — placed right after `proposal_id`. For the main fixture:

```typescript
const escalations: Escalation[] = [
  {
    proposal_id: 'q1',
    instance: 'prod',
    target: { provider: 'coolify', resource_type: 'database', uuid: 'db1', name: 'pg1' },
    risk: 'safe',
    kind: 'question',
    reasoning: 'rule #572',
    plan: {
      generated_by: 'sonnet',
      root_cause: 'x',
      steps: ['s'],
      infraops_tools: [],
      risk: 'caution',
      rollback: 'r',
      cm_window_hint: 'h',
    },
  },
];
```

And the `held` fixture in the "Auto-fix held" test spreads `escalations[0]`, so it inherits `instance` automatically — no change needed there.

- [ ] **Step 7: Run the full suite + build to confirm nothing else broke**

Run: `npx vitest run && npm run build`
Expected: all tests pass; `tsc` exits 0 (no type errors). If any other `Escalation` literal exists without `instance`, the build will name the file/line — add `instance` there too.

- [ ] **Step 8: Commit**

```bash
git add src/standards/remediation-report.ts src/standards/run-remediation.ts tests/run-remediation.test.ts tests/remediation-report.test.ts
git commit -m "feat: add instance to the Escalation contract (carries prod/dev to the change manager)"
```

---

## Task 2: Bump the report `schema_version` to 2

**Files:**

- Modify: `src/standards/remediation-report.ts` (`buildRemediationReport`)
- Test: `tests/remediation-report.test.ts`

- [ ] **Step 1: Update the failing assertion**

In `tests/remediation-report.test.ts`, find the `buildRemediationReport` test that asserts `expect(r.schema_version).toBe(1);` and change it to:

```typescript
expect(r.schema_version).toBe(2);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/remediation-report.test.ts`
Expected: FAIL — `expected 1 to be 2` (the builder still emits 1).

- [ ] **Step 3: Bump the version in the builder**

In `src/standards/remediation-report.ts`, inside `buildRemediationReport`, change `schema_version: 1,` to:

```typescript
    schema_version: 2,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/remediation-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/standards/remediation-report.ts tests/remediation-report.test.ts
git commit -m "feat: bump remediation report schema_version to 2 (escalations now carry instance)"
```

---

## Task 3: Rebuild and commit `dist/`

**Files:**

- Modify: `dist/**` (compiled output — tracked, run directly by launchd)

- [ ] **Step 1: Clean rebuild**

Run: `npm run clean && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 2: Confirm the full suite is green**

Run: `npx vitest run`
Expected: all tests pass. Note the count.

- [ ] **Step 3: Commit the rebuilt artifacts**

```bash
git add dist/
git commit -m "build: compile escalation contract v2 to dist/"
```

- [ ] **Step 4: Verify dist is in sync with src**

Run: `npm run build && git status --short dist/`
Expected: empty output (committed dist matches src).

---

## Self-Review (completed by plan author)

- **Spec coverage:** the spec's "Contract fix (prerequisite)" requires (a) `instance` on `Escalation`, (b) threaded from `run-remediation`, (c) `schema_version → 2`. Task 1 covers (a)+(b); Task 2 covers (c); Task 3 ships the tracked artifact. Complete.
- **Placeholders:** none — every step shows the exact edit.
- **Type consistency:** `instance: string` matches `CoolifyInstance` values (`"prod"`/`"dev"`) used as strings in the report; `t.instance` is the `Tagged.instance` already present in `run-remediation.ts`; the test asserts `"prod"` to match the `["prod"]` audit in that case.
- **Note:** Task 1 Step 6 is reactive (fix fixtures the new required field breaks) — the build in Step 7 is the backstop that surfaces any missed `Escalation` literal.
