# Remediation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily pipeline that reads the drift-audit report, auto-applies `safe` remediations deterministically (after a live re-audit), and packages everything harder into a Sonnet-written handoff for human/change-manager review — chained into the existing 03:00 launchd job.

**Architecture:** A testable core (`run-remediation.ts`, dependency-injected exactly like `run-audit.ts`) plus a thin IO CLI (`remediate-cli.ts`, mirroring `audit-cli.ts`). The core re-audits live via `auditInstance`, partitions proposals, applies `safe` ones through a whitelisted executor, and asks Sonnet to plan the rest. The shell script chains audit → remediate → one consolidated email.

**Tech Stack:** TypeScript (Node 18+, ESM, `.js` import specifiers), vitest, Zod, `@anthropic-ai/sdk` (new), the existing `coolify-client` and `standards/*` modules. Bash + launchd + BWS for scheduling.

**Spec:** `docs/superpowers/specs/2026-06-13-remediation-pipeline-design.md`

**Conventions in this repo (follow exactly):**

- Source imports use `.js` specifiers even from `.ts` files (`import { x } from "./y.js"`).
- Tests live in `tests/`, import from `../src/...js`, mock with `vi.mock("../src/services/X.js", () => ({...}))`.
- Each tool/client module already exists; reuse `coolifyGet` / `coolifyPatch` from `src/services/coolify-client.ts`.
- Build: `npm run build`. Test: `npx vitest run`. Single file: `npx vitest run tests/NAME.test.ts`.
- Commit after each task. Branch is `feat/remediation-pipeline` (already created).

---

## File Structure

| File                                                                                                                                                                 | Responsibility                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/standards/executor.ts` (new)                                                                                                                                    | `SAFE_TOOLS` whitelist, `isAutoApplicable`, `wouldChange`, `applyAction`, `maxAutoApplies`. The only place an autonomous write originates. |
| `src/standards/remediation-plan.ts` (new)                                                                                                                            | `RemediationPlanSchema`/`RemediationPlan`, `buildPlanPrompt`, `rawFallback`, `planEscalation` (Sonnet via injected SDK client).            |
| `src/standards/remediation-report.ts` (new)                                                                                                                          | `Escalation`/`RemediationReport` types, `buildRemediationReport`, `renderRemediationMarkdown`.                                             |
| `src/standards/run-remediation.ts` (new)                                                                                                                             | `runRemediation` — dep-injected core: re-audit, partition, runaway guard, apply, plan, self-resolved, assemble report.                     |
| `src/cli/remediate-cli.ts` (new)                                                                                                                                     | Arg parsing, wires real deps (auditInstance, applyAction, planEscalation), writes artifacts, exit codes.                                   |
| `scripts/drift-audit.sh` (modify)                                                                                                                                    | Add remediate step; consolidated email with raw-audit fallback; combined rc.                                                               |
| `scripts/com.devon.infra-drift.plist.template` (modify)                                                                                                              | `Hour` 7 → 3.                                                                                                                              |
| `scripts/README.md` (modify)                                                                                                                                         | Document the remediate step, artifacts, dry-run smoke test, change-manager consumer.                                                       |
| `package.json` (modify)                                                                                                                                              | Add `@anthropic-ai/sdk` dependency.                                                                                                        |
| `tests/executor.test.ts`, `tests/remediation-plan.test.ts`, `tests/remediation-report.test.ts`, `tests/run-remediation.test.ts`, `tests/remediate-cli.test.ts` (new) | Tests.                                                                                                                                     |

---

## Task 1: Add the Anthropic SDK dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the SDK**

Run: `npm install @anthropic-ai/sdk`

Expected: `package.json` gains `"@anthropic-ai/sdk": "^0.6x.x"` (or current) under `dependencies`; `package-lock.json` updated.

- [ ] **Step 2: Verify it imports under the project's ESM/tsc config**

Create a throwaway check, run it, then delete it:

Run:

```bash
node --input-type=module -e "import Anthropic from '@anthropic-ai/sdk'; console.log(typeof Anthropic)"
```

Expected: prints `function` (the default export is the client class).

- [ ] **Step 3: Confirm the build still passes**

Run: `npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @anthropic-ai/sdk for remediation plan generation"
```

---

## Task 2: executor — `wouldChange` and `isAutoApplicable` (pure logic)

**Files:**

- Create: `src/standards/executor.ts`
- Test: `tests/executor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/executor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { wouldChange, isAutoApplicable } from '../src/standards/executor.js';
import type { Proposal } from '../src/standards/check-engine.js';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'coolify.enable_healthcheck:deadbeef',
    kind: 'remediation',
    source: 'standards-audit',
    status: 'pending',
    target: { provider: 'coolify', resource_type: 'application', uuid: 'u1', name: 'app1' },
    description: "App 'app1' violates standard",
    reasoning: 'infra-brain rule #570',
    confidence: 'high',
    risk: 'safe',
    planned_action: {
      tool: 'coolify_update_application',
      args: { uuid: 'u1', health_check_enabled: true },
    },
    question: null,
    ...overrides,
  };
}

describe('wouldChange', () => {
  it('returns true when a non-uuid arg differs from current state', () => {
    expect(
      wouldChange(
        { uuid: 'u1', health_check_enabled: false },
        { uuid: 'u1', health_check_enabled: true },
      ),
    ).toBe(true);
  });
  it('returns false when all non-uuid args already match (idempotent no-op)', () => {
    expect(
      wouldChange(
        { uuid: 'u1', health_check_enabled: true, extra: 'x' },
        { uuid: 'u1', health_check_enabled: true },
      ),
    ).toBe(false);
  });
  it('ignores the uuid field when comparing', () => {
    expect(
      wouldChange(
        { uuid: 'DIFFERENT', health_check_enabled: true },
        { uuid: 'u1', health_check_enabled: true },
      ),
    ).toBe(false);
  });
});

describe('isAutoApplicable', () => {
  it('accepts a safe, high-confidence remediation whose tool is whitelisted', () => {
    expect(isAutoApplicable(makeProposal())).toBe(true);
  });
  it('rejects caution risk', () => {
    expect(isAutoApplicable(makeProposal({ risk: 'caution' }))).toBe(false);
  });
  it('rejects destructive risk', () => {
    expect(isAutoApplicable(makeProposal({ risk: 'destructive' }))).toBe(false);
  });
  it('rejects non-high confidence', () => {
    expect(isAutoApplicable(makeProposal({ confidence: 'medium' }))).toBe(false);
  });
  it('rejects kind=question', () => {
    expect(isAutoApplicable(makeProposal({ kind: 'question', planned_action: null }))).toBe(false);
  });
  it('rejects a null planned_action', () => {
    expect(isAutoApplicable(makeProposal({ planned_action: null }))).toBe(false);
  });
  it('rejects a tool that is not in SAFE_TOOLS', () => {
    expect(
      isAutoApplicable(
        makeProposal({
          planned_action: { tool: 'coolify_delete_application', args: { uuid: 'u1' } },
        }),
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/executor.test.ts`
Expected: FAIL — `Cannot find module '../src/standards/executor.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/standards/executor.ts`:

```typescript
import { coolifyGet, coolifyPatch } from '../services/coolify-client.js';
import type { CoolifyInstance } from '../services/coolify-client.js';
import type { Proposal } from './check-engine.js';

/**
 * A whitelisted safe remediation: how to re-read the live resource (for the
 * idempotency check) and how to apply the change. This map is the safety
 * keystone — only tools present here can ever be auto-applied.
 */
interface SafeTool {
  fetch: (
    args: Record<string, unknown>,
    instance: CoolifyInstance,
  ) => Promise<Record<string, unknown>>;
  apply: (args: Record<string, unknown>, instance: CoolifyInstance) => Promise<unknown>;
}

export const SAFE_TOOLS: Record<string, SafeTool> = {
  coolify_update_application: {
    fetch: (args, instance) =>
      coolifyGet<Record<string, unknown>>(`/applications/${args.uuid}`, undefined, instance),
    apply: (args, instance) => {
      const { uuid, ...fields } = args;
      return coolifyPatch(`/applications/${uuid}`, fields, instance);
    },
  },
};

/** True if applying `args` would actually change the resource (uuid is the selector, not a field). */
export function wouldChange(
  current: Record<string, unknown>,
  args: Record<string, unknown>,
): boolean {
  for (const [k, v] of Object.entries(args)) {
    if (k === 'uuid') continue;
    if (current[k] !== v) return true;
  }
  return false;
}

/** The four-gate check: only safe, high-confidence, whitelisted remediations may auto-apply. */
export function isAutoApplicable(p: Proposal): boolean {
  return (
    p.kind === 'remediation' &&
    p.risk === 'safe' &&
    p.confidence === 'high' &&
    p.planned_action !== null &&
    Object.prototype.hasOwnProperty.call(SAFE_TOOLS, p.planned_action.tool)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/executor.test.ts`
Expected: PASS (all `wouldChange` and `isAutoApplicable` cases).

- [ ] **Step 5: Commit**

```bash
git add src/standards/executor.ts tests/executor.test.ts
git commit -m "feat: executor gate + idempotency primitives (wouldChange, isAutoApplicable)"
```

---

## Task 3: executor — `applyAction` + `maxAutoApplies`

**Files:**

- Modify: `src/standards/executor.ts`
- Test: `tests/executor.test.ts` (add a mock + new describe blocks)

- [ ] **Step 1: Write the failing test**

At the **very top** of `tests/executor.test.ts` (before the existing imports), add the mock and import `vi`:

```typescript
import { vi } from 'vitest';

const coolifyGet = vi.fn();
const coolifyPatch = vi.fn();
vi.mock('../src/services/coolify-client.js', () => ({
  coolifyGet: (...a: unknown[]) => coolifyGet(...a),
  coolifyPatch: (...a: unknown[]) => coolifyPatch(...a),
}));
```

Then add `applyAction`, `maxAutoApplies`, and `beforeEach` to the existing imports line:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  wouldChange,
  isAutoApplicable,
  applyAction,
  maxAutoApplies,
} from '../src/standards/executor.js';
```

Append these describe blocks to `tests/executor.test.ts`:

```typescript
describe('applyAction', () => {
  beforeEach(() => {
    coolifyGet.mockReset();
    coolifyPatch.mockReset();
  });

  it('applies a drifted safe remediation: one PATCH with the args minus uuid', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', health_check_enabled: false });
    coolifyPatch.mockResolvedValue({});
    const res = await applyAction(makeProposal(), 'prod');
    expect(res.status).toBe('applied');
    expect(coolifyPatch).toHaveBeenCalledTimes(1);
    expect(coolifyPatch).toHaveBeenCalledWith(
      '/applications/u1',
      { health_check_enabled: true },
      'prod',
    );
  });

  it('skips (no PATCH) when the resource already conforms — idempotent', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', health_check_enabled: true });
    const res = await applyAction(makeProposal(), 'prod');
    expect(res.status).toBe('skipped');
    expect(coolifyPatch).not.toHaveBeenCalled();
  });

  it('dry-run previews without PATCHing even when drifted', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', health_check_enabled: false });
    const res = await applyAction(makeProposal(), 'prod', { dryRun: true });
    expect(res.status).toBe('skipped');
    expect(res.detail).toMatch(/dry-run/i);
    expect(coolifyPatch).not.toHaveBeenCalled();
  });

  it('records failed (no throw) when the client errors, leaving the batch to continue', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', health_check_enabled: false });
    coolifyPatch.mockRejectedValue(new Error('boom'));
    const res = await applyAction(makeProposal(), 'prod');
    expect(res.status).toBe('failed');
    expect(res.detail).toContain('boom');
  });

  it('refuses (failed, no fetch) a non-auto-applicable proposal as defense in depth', async () => {
    const res = await applyAction(makeProposal({ risk: 'destructive' }), 'prod');
    expect(res.status).toBe('failed');
    expect(coolifyGet).not.toHaveBeenCalled();
    expect(coolifyPatch).not.toHaveBeenCalled();
  });
});

describe('maxAutoApplies', () => {
  const orig = process.env.MAX_AUTO_APPLIES;
  beforeEach(() => {
    delete process.env.MAX_AUTO_APPLIES;
  });
  afterAll(() => {
    if (orig !== undefined) process.env.MAX_AUTO_APPLIES = orig;
  });

  it('defaults to 20', () => {
    expect(maxAutoApplies()).toBe(20);
  });
  it('reads a positive integer from env', () => {
    process.env.MAX_AUTO_APPLIES = '5';
    expect(maxAutoApplies()).toBe(5);
  });
  it('falls back to 20 on a non-numeric env value', () => {
    process.env.MAX_AUTO_APPLIES = 'nonsense';
    expect(maxAutoApplies()).toBe(20);
  });
});
```

Add `afterAll` to the vitest import: `import { describe, it, expect, beforeEach, afterAll } from "vitest";`

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/executor.test.ts`
Expected: FAIL — `applyAction`/`maxAutoApplies` are not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/standards/executor.ts`:

```typescript
export interface ApplyResult {
  proposal_id: string;
  target: Proposal['target'];
  tool: string;
  args: Record<string, unknown>;
  status: 'applied' | 'skipped' | 'failed';
  detail: string;
}

/** Read MAX_AUTO_APPLIES from env (positive integer); default 20. The runaway guard ceiling. */
export function maxAutoApplies(): number {
  const raw = process.env.MAX_AUTO_APPLIES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 20;
}

/**
 * Apply one safe remediation. Re-reads live state first: skips if already
 * conformant (idempotent), previews under dryRun, applies otherwise. Never
 * throws — a client failure is captured as status "failed" so the batch
 * continues. Defense in depth: a non-auto-applicable proposal is refused
 * without any network call.
 */
export async function applyAction(
  p: Proposal,
  instance: CoolifyInstance,
  opts: { dryRun?: boolean } = {},
): Promise<ApplyResult> {
  const base = {
    proposal_id: p.id,
    target: p.target,
    tool: p.planned_action?.tool ?? '',
    args: p.planned_action?.args ?? {},
  };

  if (!isAutoApplicable(p)) {
    return { ...base, status: 'failed', detail: 'not auto-applicable (gate failed)' };
  }

  const tool = SAFE_TOOLS[p.planned_action!.tool];
  const args = p.planned_action!.args;

  try {
    const current = await tool.fetch(args, instance);
    if (!wouldChange(current, args)) {
      return { ...base, status: 'skipped', detail: 'already conformant' };
    }
    if (opts.dryRun) {
      return { ...base, status: 'skipped', detail: 'dry-run (would apply)' };
    }
    await tool.apply(args, instance);
    return { ...base, status: 'applied', detail: 'applied successfully' };
  } catch (e) {
    return { ...base, status: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/executor.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/standards/executor.ts tests/executor.test.ts
git commit -m "feat: executor applyAction (live re-check, dry-run, failure isolation) + maxAutoApplies"
```

---

## Task 4: remediation-plan — schema, prompt, raw fallback (pure logic)

**Files:**

- Create: `src/standards/remediation-plan.ts`
- Test: `tests/remediation-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/remediation-plan.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildPlanPrompt,
  rawFallback,
  RemediationPlanSchema,
} from '../src/standards/remediation-plan.js';
import type { Proposal } from '../src/standards/check-engine.js';

function questionProposal(): Proposal {
  return {
    id: '572:e4f2022e',
    kind: 'question',
    source: 'standards-audit',
    status: 'pending',
    target: {
      provider: 'coolify',
      resource_type: 'database',
      uuid: 'db1',
      name: 'agent-sites-postgres',
    },
    description: "Database 'agent-sites-postgres' violates standard: backups must be defined.",
    reasoning: 'infra-brain rule #572 (WARN): databases must have backups.',
    confidence: 'high',
    risk: 'safe',
    planned_action: null,
    question: "Database 'agent-sites-postgres' violates standard. Review and fix manually?",
  };
}

describe('buildPlanPrompt', () => {
  it('includes the resource name, the violated rule reasoning, and the description', () => {
    const prompt = buildPlanPrompt(questionProposal());
    expect(prompt).toContain('agent-sites-postgres');
    expect(prompt).toContain('rule #572');
    expect(prompt).toContain('backups must be defined');
  });
  it('is deterministic (no timestamps / randomness)', () => {
    expect(buildPlanPrompt(questionProposal())).toBe(buildPlanPrompt(questionProposal()));
  });
});

describe('rawFallback', () => {
  it('produces a schema-valid plan tagged generated_by=raw from the proposal alone', () => {
    const plan = rawFallback(questionProposal());
    expect(plan.generated_by).toBe('raw');
    expect(() => RemediationPlanSchema.parse(plan)).not.toThrow();
    expect(plan.root_cause).toContain('rule #572');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/remediation-plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/standards/remediation-plan.ts`:

```typescript
import { z } from 'zod';
import type { Proposal } from './check-engine.js';

/** The structured remediation plan Sonnet returns for one escalated proposal. */
export const RemediationPlanSchema = z.object({
  generated_by: z.enum(['sonnet', 'raw']),
  root_cause: z.string(),
  steps: z.array(z.string()),
  infraops_tools: z.array(z.string()),
  risk: z.enum(['safe', 'caution', 'destructive']),
  rollback: z.string(),
  cm_window_hint: z.string(),
});
export type RemediationPlan = z.infer<typeof RemediationPlanSchema>;

/** Schema sent to the model — same shape minus generated_by, which we stamp ourselves. */
export const PlanModelSchema = RemediationPlanSchema.omit({ generated_by: true });

/** Deterministic prompt for one escalated proposal. No timestamps/randomness (keeps tests + caching stable). */
export function buildPlanPrompt(p: Proposal): string {
  return [
    'You are an infrastructure change planner for a Coolify-based platform.',
    'A daily standards audit flagged the following deviation that cannot be auto-fixed.',
    'Write a concrete remediation plan a careful operator (or a change-manager process) can execute.',
    '',
    `Resource: ${p.target.resource_type} '${p.target.name}' (uuid ${p.target.uuid}, provider ${p.target.provider})`,
    `Deviation: ${p.description}`,
    `Why it matters: ${p.reasoning}`,
    p.question ? `Open question: ${p.question}` : '',
    '',
    "Infrastructure context: changes are made via the infraops MCP server's coolify_* tools",
    '(e.g. coolify_update_application, coolify_create_scheduled_task, coolify_update_database).',
    'Domains follow appname.devonwatkins.com; secrets live in Bitwarden Secrets Manager.',
    '',
    'Return: root cause, ordered concrete steps, which infraops tools to use, the risk of',
    'the fix itself (safe/caution/destructive), how to roll back, and a change-window hint.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Deterministic fallback when Sonnet is unreachable — keeps the pipeline flowing. */
export function rawFallback(p: Proposal): RemediationPlan {
  return {
    generated_by: 'raw',
    root_cause: p.reasoning,
    steps: [
      p.question ?? p.description,
      'Review manually and choose the appropriate infraops remediation.',
    ],
    infraops_tools: [],
    risk: p.risk,
    rollback: 'n/a — manual review required before any change.',
    cm_window_hint: 'Review during the next scheduled change-management window.',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/remediation-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/standards/remediation-plan.ts tests/remediation-plan.test.ts
git commit -m "feat: remediation plan schema, deterministic prompt, raw fallback"
```

---

## Task 5: remediation-plan — `planEscalation` (Sonnet via injected client)

**Files:**

- Modify: `src/standards/remediation-plan.ts`
- Test: `tests/remediation-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/remediation-plan.test.ts`:

```typescript
import { planEscalation } from '../src/standards/remediation-plan.js';

function fakeClient(impl: () => Promise<unknown>) {
  return { messages: { parse: impl } } as unknown as import('@anthropic-ai/sdk').default;
}

describe('planEscalation', () => {
  it('returns a sonnet-tagged plan when the model responds with valid structured output', async () => {
    const client = fakeClient(async () => ({
      parsed_output: {
        root_cause: 'No backup schedule configured.',
        steps: ['Create a nightly backup scheduled task.'],
        infraops_tools: ['coolify_create_scheduled_task'],
        risk: 'caution',
        rollback: 'Delete the scheduled task.',
        cm_window_hint: 'Off-peak; additive and non-disruptive.',
      },
    }));
    const plan = await planEscalation(questionProposal(), client);
    expect(plan.generated_by).toBe('sonnet');
    expect(plan.infraops_tools).toContain('coolify_create_scheduled_task');
  });

  it('falls back to raw when parsed_output is null', async () => {
    const client = fakeClient(async () => ({ parsed_output: null }));
    const plan = await planEscalation(questionProposal(), client);
    expect(plan.generated_by).toBe('raw');
  });

  it('falls back to raw (never throws) when the API call rejects', async () => {
    const client = fakeClient(async () => {
      throw new Error('api down');
    });
    const plan = await planEscalation(questionProposal(), client);
    expect(plan.generated_by).toBe('raw');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/remediation-plan.test.ts`
Expected: FAIL — `planEscalation` not exported.

- [ ] **Step 3: Write the minimal implementation**

Add imports at the top of `src/standards/remediation-plan.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
```

Append:

```typescript
/**
 * Ask Sonnet to plan one escalated proposal. The client is injected for testing;
 * in production we construct a default Anthropic() (reads ANTHROPIC_API_KEY).
 * Best-effort: any failure or empty parse degrades to the deterministic raw
 * fallback so the pipeline never blocks on the model.
 *
 * Model is claude-sonnet-4-6 by explicit choice (plan quality over executor cost).
 */
export async function planEscalation(p: Proposal, client?: Anthropic): Promise<RemediationPlan> {
  const anthropic = client ?? new Anthropic();
  try {
    const res = await anthropic.messages.parse({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: zodOutputFormat(PlanModelSchema) },
      messages: [{ role: 'user', content: buildPlanPrompt(p) }],
    });
    const parsed = (res as { parsed_output?: z.infer<typeof PlanModelSchema> | null })
      .parsed_output;
    if (!parsed) return rawFallback(p);
    return { ...parsed, generated_by: 'sonnet' };
  } catch {
    return rawFallback(p);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/remediation-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the build (the SDK types must resolve)**

Run: `npm run build`
Expected: exits 0. If `messages.parse` or `zodOutputFormat` type-errors against the installed SDK version, adjust to the SDK's actual surface (see `typescript/claude-api/tool-use.md` → Structured Outputs) — the call shape is: `client.messages.parse({ model, max_tokens, output_config: { format: zodOutputFormat(schema) }, messages })` returning `.parsed_output`.

- [ ] **Step 6: Commit**

```bash
git add src/standards/remediation-plan.ts tests/remediation-plan.test.ts
git commit -m "feat: planEscalation via Sonnet structured output with raw fallback"
```

---

## Task 6: remediation-report — `buildRemediationReport`

**Files:**

- Create: `src/standards/remediation-report.ts`
- Test: `tests/remediation-report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/remediation-report.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildRemediationReport, type Escalation } from '../src/standards/remediation-report.js';
import type { ApplyResult } from '../src/standards/executor.js';

const applied: ApplyResult[] = [
  {
    proposal_id: 'a1',
    target: { provider: 'coolify', resource_type: 'application', uuid: 'u1', name: 'app1' },
    tool: 'coolify_update_application',
    args: { uuid: 'u1' },
    status: 'applied',
    detail: 'ok',
  },
  {
    proposal_id: 'a2',
    target: { provider: 'coolify', resource_type: 'application', uuid: 'u2', name: 'app2' },
    tool: 'coolify_update_application',
    args: { uuid: 'u2' },
    status: 'skipped',
    detail: 'already conformant',
  },
  {
    proposal_id: 'a3',
    target: { provider: 'coolify', resource_type: 'application', uuid: 'u3', name: 'app3' },
    tool: 'coolify_update_application',
    args: { uuid: 'u3' },
    status: 'failed',
    detail: 'boom',
  },
];

const escalations: Escalation[] = [
  {
    proposal_id: 'q1',
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

describe('buildRemediationReport', () => {
  it('computes totals from applied results and escalations', () => {
    const r = buildRemediationReport({
      generatedAt: '2026-06-13T07:00:00Z',
      sourceReport: '2026-06-13.json',
      applied,
      escalations,
      selfResolved: 2,
      runawayTripped: false,
    });
    expect(r.schema_version).toBe(1);
    expect(r.totals).toEqual({
      applied: 1,
      skipped: 1,
      failed: 1,
      escalated: 1,
      self_resolved: 2,
      runaway_tripped: false,
    });
    expect(r.source_report).toBe('2026-06-13.json');
    expect(r.applied).toHaveLength(3);
    expect(r.escalations).toHaveLength(1);
  });
  it('carries the runaway flag through', () => {
    const r = buildRemediationReport({
      generatedAt: 't',
      sourceReport: 's',
      applied: [],
      escalations,
      selfResolved: 0,
      runawayTripped: true,
    });
    expect(r.totals.runaway_tripped).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/remediation-report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/standards/remediation-report.ts`:

```typescript
import type { ApplyResult } from './executor.js';
import type { Proposal } from './check-engine.js';
import type { RemediationPlan } from './remediation-plan.js';

/** One escalated (non-auto-fixable) item plus its Sonnet/raw plan. The change-manager contract. */
export interface Escalation {
  proposal_id: string;
  target: Proposal['target'];
  risk: string;
  kind: string;
  reasoning: string;
  plan: RemediationPlan;
}

export interface RemediationReport {
  schema_version: number;
  generated_at: string;
  source_report: string;
  totals: {
    applied: number;
    skipped: number;
    failed: number;
    escalated: number;
    self_resolved: number;
    runaway_tripped: boolean;
  };
  applied: ApplyResult[];
  escalations: Escalation[];
}

export function buildRemediationReport(args: {
  generatedAt: string;
  sourceReport: string;
  applied: ApplyResult[];
  escalations: Escalation[];
  selfResolved: number;
  runawayTripped: boolean;
}): RemediationReport {
  const count = (s: ApplyResult['status']) => args.applied.filter((a) => a.status === s).length;
  return {
    schema_version: 1,
    generated_at: args.generatedAt,
    source_report: args.sourceReport,
    totals: {
      applied: count('applied'),
      skipped: count('skipped'),
      failed: count('failed'),
      escalated: args.escalations.length,
      self_resolved: args.selfResolved,
      runaway_tripped: args.runawayTripped,
    },
    applied: args.applied,
    escalations: args.escalations,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/remediation-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/standards/remediation-report.ts tests/remediation-report.test.ts
git commit -m "feat: buildRemediationReport (versioned contract + totals)"
```

---

## Task 7: remediation-report — `renderRemediationMarkdown`

**Files:**

- Modify: `src/standards/remediation-report.ts`
- Test: `tests/remediation-report.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/remediation-report.test.ts`:

```typescript
import {
  renderRemediationMarkdown,
  buildRemediationReport as build2,
} from '../src/standards/remediation-report.js';

describe('renderRemediationMarkdown', () => {
  it('renders a headline, an applied section, and an escalations section with the plan', () => {
    const r = build2({
      generatedAt: '2026-06-13T07:00:00Z',
      sourceReport: '2026-06-13.json',
      applied,
      escalations,
      selfResolved: 0,
      runawayTripped: false,
    });
    const md = renderRemediationMarkdown(r);
    expect(md).toContain('# Infra Remediation');
    expect(md).toContain('1 fixed');
    expect(md).toContain('1 need'); // escalations needing attention
    expect(md).toContain('app1'); // an applied target
    expect(md).toContain('pg1'); // an escalated target
    expect(md).toContain('coolify_create_scheduled_task'.slice(0, 0) || 'Plan'); // a plan section header
  });

  it('renders cleanly on an empty day (nothing drifted)', () => {
    const r = build2({
      generatedAt: 't',
      sourceReport: 's',
      applied: [],
      escalations: [],
      selfResolved: 0,
      runawayTripped: false,
    });
    const md = renderRemediationMarkdown(r);
    expect(md).toContain('0 fixed');
    expect(md).toMatch(/no .* attention|nothing/i);
  });

  it('surfaces a loud banner when the runaway guard tripped', () => {
    const r = build2({
      generatedAt: 't',
      sourceReport: 's',
      applied: [],
      escalations,
      selfResolved: 0,
      runawayTripped: true,
    });
    const md = renderRemediationMarkdown(r);
    expect(md).toMatch(/runaway|safety guard/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/remediation-report.test.ts`
Expected: FAIL — `renderRemediationMarkdown` not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/standards/remediation-report.ts`:

```typescript
/** Human-readable digest for the daily consolidated email. */
export function renderRemediationMarkdown(r: RemediationReport): string {
  const t = r.totals;
  const lines: string[] = [];
  lines.push(`# Infra Remediation — ${r.generated_at}`);
  lines.push('');
  lines.push(
    `**${t.applied} fixed**, ${t.escalated} need attention ` +
      `(skipped ${t.skipped}, failed ${t.failed}, self-resolved ${t.self_resolved}).`,
  );
  if (t.runaway_tripped) {
    lines.push('');
    lines.push(
      `> ⚠️ **Safety guard tripped:** the live safe-fix count exceeded MAX_AUTO_APPLIES, ` +
        `so NOTHING was auto-applied — every item was escalated for review.`,
    );
  }
  lines.push('');

  lines.push('## Auto-applied');
  if (!r.applied.length) {
    lines.push('- _none_');
  } else {
    for (const a of r.applied) {
      const icon = a.status === 'applied' ? '✅' : a.status === 'skipped' ? '⏭️' : '❌';
      lines.push(`- ${icon} **${a.target.name}** (${a.tool}) — ${a.status}: ${a.detail}`);
    }
  }
  lines.push('');

  lines.push('## Escalated — needs review');
  if (!r.escalations.length) {
    lines.push('- _nothing needs your attention_');
  } else {
    for (const e of r.escalations) {
      lines.push('');
      lines.push(
        `### ${e.target.resource_type} '${e.target.name}' (${e.risk}) — plan by ${e.plan.generated_by}`,
      );
      lines.push(`- **Why:** ${e.reasoning}`);
      lines.push(`- **Root cause:** ${e.plan.root_cause}`);
      lines.push(`- **Steps:**`);
      for (const s of e.plan.steps) lines.push(`  1. ${s}`);
      lines.push(`- **Tools:** ${e.plan.infraops_tools.join(', ') || '—'}`);
      lines.push(`- **Fix risk:** ${e.plan.risk} · **Rollback:** ${e.plan.rollback}`);
      lines.push(`- **Change window:** ${e.plan.cm_window_hint}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/remediation-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/standards/remediation-report.ts tests/remediation-report.test.ts
git commit -m "feat: renderRemediationMarkdown digest (applied + escalated + runaway banner)"
```

---

## Task 8: run-remediation — the dep-injected core

**Files:**

- Create: `src/standards/run-remediation.ts`
- Test: `tests/run-remediation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/run-remediation.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runRemediation, type RemediationDeps } from '../src/standards/run-remediation.js';
import type { AuditResult } from '../src/standards/run-audit.js';
import type { Proposal, Risk } from '../src/standards/check-engine.js';
import type { ApplyResult } from '../src/standards/executor.js';
import type { RemediationPlan } from '../src/standards/remediation-plan.js';
import type { DriftReport } from '../src/standards/report.js';

let n = 0;
function prop(ruleKey: string, uuid: string, opts: Partial<Proposal> = {}): Proposal {
  return {
    id: `${ruleKey}:${(n++).toString(16).padStart(8, '0')}`,
    kind: 'remediation',
    source: 'standards-audit',
    status: 'pending',
    target: { provider: 'coolify', resource_type: 'application', uuid, name: `name-${uuid}` },
    description: `App '${uuid}' violates ${ruleKey}`,
    reasoning: `infra-brain rule ${ruleKey}`,
    confidence: 'high',
    risk: 'safe' as Risk,
    planned_action: {
      tool: 'coolify_update_application',
      args: { uuid, health_check_enabled: true },
    },
    question: null,
    ...opts,
  };
}

function auditResult(proposals: Proposal[]): AuditResult {
  return {
    meta: { standards_source: 'live', checks_evaluated: 1, not_audited: 0 },
    summary: {
      total_proposals: proposals.length,
      by_risk: { safe: 0, caution: 0, destructive: 0 },
      by_kind: { remediation: 0, question: 0 },
    },
    proposals,
  };
}

const appliedOk = (p: Proposal): ApplyResult => ({
  proposal_id: p.id,
  target: p.target,
  tool: 'coolify_update_application',
  args: p.planned_action!.args,
  status: 'applied',
  detail: 'ok',
});
const plan = (): RemediationPlan => ({
  generated_by: 'sonnet',
  root_cause: 'x',
  steps: ['s'],
  infraops_tools: [],
  risk: 'caution',
  rollback: 'r',
  cm_window_hint: 'h',
});

function deps(over: Partial<RemediationDeps> = {}): RemediationDeps {
  return {
    audit: vi.fn(async () => auditResult([])),
    apply: vi.fn(async (p: Proposal) => appliedOk(p)),
    plan: vi.fn(async () => plan()),
    maxAutoApplies: 20,
    dryRun: false,
    ...over,
  };
}

describe('runRemediation', () => {
  it('applies safe proposals and escalates questions', async () => {
    const safe = prop('570', 'u1');
    const question = prop('572', 'u2', {
      kind: 'question',
      planned_action: null,
      question: 'fix?',
    });
    const d = deps({ audit: vi.fn(async () => auditResult([safe, question])) });
    const { report, cleanlyAudited } = await runRemediation(
      ['prod'],
      null,
      '2026-06-13T07:00:00Z',
      '2026-06-13.json',
      d,
    );
    expect(cleanlyAudited).toBe(true);
    expect(report.totals.applied).toBe(1);
    expect(report.totals.escalated).toBe(1);
    expect(d.apply).toHaveBeenCalledTimes(1);
    expect(d.plan).toHaveBeenCalledTimes(1);
  });

  it('trips the runaway guard: applies nothing, escalates all safe', async () => {
    const many = [prop('570', 'u1'), prop('570', 'u2'), prop('570', 'u3')];
    const d = deps({ audit: vi.fn(async () => auditResult(many)), maxAutoApplies: 2 });
    const { report } = await runRemediation(['prod'], null, 't', 's', d);
    expect(report.totals.runaway_tripped).toBe(true);
    expect(report.totals.applied).toBe(0);
    expect(report.totals.escalated).toBe(3);
    expect(d.apply).not.toHaveBeenCalled();
  });

  it('counts self-resolved: in the morning report but no longer live', async () => {
    const stillLive = prop('570', 'u1');
    const morning: DriftReport = {
      generated_at: 'earlier',
      instances: { prod: { ok: true, proposals: [stillLive, prop('571', 'GONE')] } },
      totals: {
        total_proposals: 2,
        by_risk: { safe: 2, caution: 0, destructive: 0 },
        by_kind: { remediation: 2, question: 0 },
        instances_ok: 1,
        instances_failed: 0,
      },
      delta: { new: [], resolved: [], unchanged: 0 },
    };
    const d = deps({ audit: vi.fn(async () => auditResult([stillLive])) });
    const { report } = await runRemediation(['prod'], morning, 't', 's', d);
    expect(report.totals.self_resolved).toBe(1);
  });

  it('a thrown audit for an instance does not abort the run; cleanlyAudited reflects the others', async () => {
    const audit = vi.fn(async (inst: string) => {
      if (inst === 'dev') throw new Error('unreachable');
      return auditResult([prop('570', 'u1')]);
    });
    const { report, cleanlyAudited } = await runRemediation(
      ['prod', 'dev'],
      null,
      't',
      's',
      deps({ audit }),
    );
    expect(cleanlyAudited).toBe(true);
    expect(report.totals.applied).toBe(1);
  });

  it('cleanlyAudited is false when every instance throws', async () => {
    const audit = vi.fn(async () => {
      throw new Error('down');
    });
    const { cleanlyAudited } = await runRemediation(['prod'], null, 't', 's', deps({ audit }));
    expect(cleanlyAudited).toBe(false);
  });

  it('passes dryRun through to apply', async () => {
    const apply = vi.fn(async (p: Proposal) => ({
      ...appliedOk(p),
      status: 'skipped' as const,
      detail: 'dry-run',
    }));
    const d = deps({
      audit: vi.fn(async () => auditResult([prop('570', 'u1')])),
      apply,
      dryRun: true,
    });
    await runRemediation(['prod'], null, 't', 's', d);
    expect(apply).toHaveBeenCalledWith(expect.anything(), 'prod', { dryRun: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/run-remediation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/standards/run-remediation.ts`:

```typescript
import type { CoolifyInstance } from '../services/coolify-client.js';
import type { AuditResult } from './run-audit.js';
import type { Proposal } from './check-engine.js';
import type { ApplyResult } from './executor.js';
import { isAutoApplicable } from './executor.js';
import type { RemediationPlan } from './remediation-plan.js';
import { proposalIdentity, type DriftReport } from './report.js';
import {
  buildRemediationReport,
  type Escalation,
  type RemediationReport,
} from './remediation-report.js';

export interface RemediationDeps {
  audit: (inst: CoolifyInstance) => Promise<AuditResult>;
  apply: (p: Proposal, inst: CoolifyInstance, opts: { dryRun?: boolean }) => Promise<ApplyResult>;
  plan: (p: Proposal) => Promise<RemediationPlan>;
  maxAutoApplies: number;
  dryRun: boolean;
}

interface Tagged {
  instance: CoolifyInstance;
  proposal: Proposal;
}

/**
 * The remediation core. Re-audits each instance LIVE (the idempotency guard —
 * we act on current reality, not the possibly-stale morning report), partitions
 * proposals into auto-applicable vs escalated, applies the safe ones (unless the
 * runaway guard trips), asks for a plan on the rest, and assembles the report.
 * Dependency-injected so it is fully testable without network or model access —
 * mirrors buildDriftReport in run-audit.ts / report.ts.
 */
export async function runRemediation(
  instances: CoolifyInstance[],
  morning: DriftReport | null,
  generatedAt: string,
  sourceReport: string,
  deps: RemediationDeps,
): Promise<{ report: RemediationReport; cleanlyAudited: boolean }> {
  // 1. Re-audit live. Isolate per-instance failures (never abort the run).
  const live: Tagged[] = [];
  const okInstances = new Set<CoolifyInstance>();
  let cleanlyAudited = false;

  for (const inst of instances) {
    try {
      const res = await deps.audit(inst);
      okInstances.add(inst);
      if (!res.meta.errors || res.meta.errors.length === 0) cleanlyAudited = true;
      for (const p of res.proposals) live.push({ instance: inst, proposal: p });
    } catch {
      // instance unreachable this run — its drift is unknown, not resolved
    }
  }

  // 2. Partition.
  const safe = live.filter((t) => isAutoApplicable(t.proposal));
  const escalateTagged = live.filter((t) => !isAutoApplicable(t.proposal));

  // 3. Runaway guard: a sudden fleet-wide spike of "safe" fixes is the signature
  // of a bad rule — apply nothing and escalate everything instead.
  const runawayTripped = safe.length > deps.maxAutoApplies;
  const toApply = runawayTripped ? [] : safe;
  const toEscalate = runawayTripped ? live : escalateTagged;

  // 4. Apply safe (per-item isolation lives in deps.apply — it never throws).
  const applied: ApplyResult[] = [];
  for (const t of toApply) {
    applied.push(await deps.apply(t.proposal, t.instance, { dryRun: deps.dryRun }));
  }

  // 5. Plan escalations.
  const escalations: Escalation[] = [];
  for (const t of toEscalate) {
    const plan = await deps.plan(t.proposal);
    escalations.push({
      proposal_id: t.proposal.id,
      target: t.proposal.target,
      risk: t.proposal.risk,
      kind: t.proposal.kind,
      reasoning: t.proposal.reasoning,
      plan,
    });
  }

  // 6. Self-resolved: morning proposals (for instances we could audit this run)
  // that are no longer present live.
  const liveIds = new Set(live.map((t) => proposalIdentity(t.instance, t.proposal)));
  let selfResolved = 0;
  if (morning) {
    for (const [inst, sec] of Object.entries(morning.instances)) {
      if (!okInstances.has(inst as CoolifyInstance)) continue; // couldn't confirm → not "resolved"
      for (const p of sec.proposals ?? []) {
        if (!liveIds.has(proposalIdentity(inst, p))) selfResolved++;
      }
    }
  }

  const report = buildRemediationReport({
    generatedAt,
    sourceReport,
    applied,
    escalations,
    selfResolved,
    runawayTripped,
  });
  return { report, cleanlyAudited };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/run-remediation.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Commit**

```bash
git add src/standards/run-remediation.ts tests/run-remediation.test.ts
git commit -m "feat: runRemediation core (live re-audit, partition, runaway guard, self-resolved)"
```

---

## Task 9: remediate-cli — arg parsing (testable unit)

**Files:**

- Create: `src/cli/remediate-cli.ts`
- Test: `tests/remediate-cli.test.ts`

The CLI's `main()` does IO and is wired to real deps; keep it thin and export the pure `parseArgs` for unit testing (mirrors `audit-cli.ts`, which has the same helper).

- [ ] **Step 1: Write the failing test**

Create `tests/remediate-cli.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli/remediate-cli.js';

describe('remediate-cli parseArgs', () => {
  it('parses value flags and boolean flags', () => {
    const a = parseArgs([
      '--instance',
      'prod,dev',
      '--report-dir',
      '/r',
      '--now',
      '2026-06-13T07:00:00Z',
      '--dry-run',
    ]);
    expect(a.instance).toBe('prod,dev');
    expect(a['report-dir']).toBe('/r');
    expect(a.now).toBe('2026-06-13T07:00:00Z');
    expect(a['dry-run']).toBe(true);
  });
  it('treats a trailing flag with no value as boolean true', () => {
    expect(parseArgs(['--stdout']).stdout).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/remediate-cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/cli/remediate-cli.ts` (the `parseArgs` is copied verbatim from `audit-cli.ts` — both CLIs share the same flag grammar; duplication is acceptable here since neither owns a shared CLI util and the function is tiny):

```typescript
#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { auditInstance } from '../standards/run-audit.js';
import { applyAction, maxAutoApplies } from '../standards/executor.js';
import { planEscalation } from '../standards/remediation-plan.js';
import { renderRemediationMarkdown } from '../standards/remediation-report.js';
import { runRemediation } from '../standards/run-remediation.js';
import type { DriftReport } from '../standards/report.js';
import type { CoolifyInstance } from '../services/coolify-client.js';

/**
 * Headless remediation pass. Reads the morning drift report for context, re-audits
 * live, auto-applies safe remediations, asks Sonnet to plan the rest, and writes
 * <date>.remediation.json + <date>.remediation.md. Chained after audit-cli in
 * scripts/drift-audit.sh.
 *
 *   node dist/cli/remediate-cli.js --instance prod,dev --report-dir /reports --now <iso>
 *   node dist/cli/remediate-cli.js --instance prod --report-dir /reports --dry-run
 *
 * Exit code: 0 if at least one instance was audited cleanly; 1 if every instance
 * hard-failed (keeps the heartbeat semantics identical to audit-cli).
 */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function loadReport(dir: string, basename: string): DriftReport | null {
  try {
    const p = path.join(dir, basename);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as DriftReport;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const instances = String(args.instance ?? 'prod')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as CoolifyInstance[];

  const reportDir =
    typeof args['report-dir'] === 'string' ? (args['report-dir'] as string) : undefined;
  const generatedAt =
    typeof args.now === 'string' ? (args.now as string) : new Date().toISOString();
  const dateStr = generatedAt.slice(0, 10);
  const dryRun = args['dry-run'] === true;

  const sourceBasename = `${dateStr}.json`;
  const morning = reportDir ? loadReport(reportDir, sourceBasename) : null;

  // Build one Anthropic client (reused across all plan calls).
  const anthropic = new Anthropic();

  const { report, cleanlyAudited } = await runRemediation(
    instances,
    morning,
    generatedAt,
    sourceBasename,
    {
      audit: (inst) => auditInstance(inst),
      apply: (p, inst, opts) => applyAction(p, inst, opts),
      plan: (p) => planEscalation(p, anthropic),
      maxAutoApplies: maxAutoApplies(),
      dryRun,
    },
  );

  if (reportDir && !dryRun) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportDir, `${dateStr}.remediation.json`),
      JSON.stringify(report, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(reportDir, `${dateStr}.remediation.md`),
      renderRemediationMarkdown(report),
      'utf-8',
    );
  } else {
    process.stdout.write(renderRemediationMarkdown(report) + '\n');
  }

  process.exit(cleanlyAudited ? 0 : 1);
}

// Only run main() when invoked as a script, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('remediate-cli.js')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/remediate-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the whole build + suite**

Run: `npm run build && npx vitest run`
Expected: build exits 0; all tests pass (the pre-existing suite plus the five new files).

- [ ] **Step 6: Commit**

```bash
git add src/cli/remediate-cli.ts tests/remediate-cli.test.ts
git commit -m "feat: remediate-cli — wires real deps, writes remediation artifacts, exit codes"
```

---

## Task 10: Wire the remediate step into `drift-audit.sh`

**Files:**

- Modify: `scripts/drift-audit.sh`

Read the current script first (it was last touched in commit `b946c60`). The changes: after `audit-cli.js` runs and writes the report, run `remediate-cli.js`; then email the **remediation** digest, falling back to the raw audit `.md` if the remediation step hard-failed; ping Healthchecks.io on the combined rc.

- [ ] **Step 1: Add the `ANTHROPIC_API_KEY` fetch**

In the secrets section (next to `RESEND_API_KEY="$(get_secret resend-api-key)"`), add:

```bash
export ANTHROPIC_API_KEY="$(get_secret ANTHROPIC_API_KEY)"
```

(Run `bws secret list` once on the mini to confirm the exact key name; this plan assumes `ANTHROPIC_API_KEY`. If the stored key differs, match it here and in `scripts/README.md`.)

- [ ] **Step 2: Add the remediate step after the audit step**

Immediately after the block that runs `audit-cli.js` and sets `RC`, add:

```bash
# ── Remediate: auto-apply safe fixes, package the rest (best-effort) ────────────
REMEDIATE_MD="$REPORT_DIR/$DATE.remediation.md"
node "$REPO/dist/cli/remediate-cli.js" --instance prod,dev --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1
RC_REMEDIATE=$?
log "remediate CLI exited rc=$RC_REMEDIATE"
```

- [ ] **Step 3: Switch the email to the consolidated digest with raw-audit fallback**

Change the email block so it sends `$REMEDIATE_MD` when present, else the raw audit `$MD`. Replace the existing `if [ -n "$RESEND_API_KEY" ] && [ -f "$MD" ] ...` guard's file selection: compute the body file and subject first:

```bash
# Prefer the consolidated remediation digest; fall back to the raw audit digest.
if [ -f "$REMEDIATE_MD" ]; then
  BODY_MD="$REMEDIATE_MD"
  APPLIED=$(python3 -c "import json;print(json.load(open('$REPORT_DIR/$DATE.remediation.json'))['totals']['applied'])" 2>/dev/null || echo '?')
  ESCALATED=$(python3 -c "import json;print(json.load(open('$REPORT_DIR/$DATE.remediation.json'))['totals']['escalated'])" 2>/dev/null || echo '?')
  SUBJECT="Infra remediation $DATE — ${APPLIED} fixed, ${ESCALATED} need you"
else
  BODY_MD="$MD"
  SUBJECT="Infra drift $DATE — audit only (remediation step failed)"
fi
```

Then point the existing Resend `python3` payload builder and `curl` at `$BODY_MD` and `$SUBJECT` instead of `$MD`/the old subject. (Keep the existing `[ -n "$RESEND_API_KEY" ] && [ -f "$BODY_MD" ]` guard.)

- [ ] **Step 4: Combine the rc for the heartbeat**

Where the script currently pings Healthchecks.io based on `RC`, change the success condition to require **both** steps healthy:

```bash
# Healthy only if the audit was clean AND the remediation pass didn't hard-fail.
if [ "$RC" -eq 0 ] && [ "$RC_REMEDIATE" -eq 0 ]; then
  curl -fsS --max-time 10 "$HC_URL" >/dev/null 2>&1 || log "WARN: HC success ping failed"
else
  curl -fsS --max-time 10 "$HC_URL/fail" >/dev/null 2>&1 || true
  log "pinged HC /fail (audit rc=$RC remediate rc=$RC_REMEDIATE)"
fi
```

And update the final `exit` to reflect the combined status:

```bash
log "──────── drift audit + remediate done (audit rc=$RC remediate rc=$RC_REMEDIATE) ────────"
[ "$RC" -eq 0 ] && [ "$RC_REMEDIATE" -eq 0 ] && exit 0 || exit 1
```

- [ ] **Step 5: Syntax-check the script**

Run: `bash -n scripts/drift-audit.sh`
Expected: no output (valid syntax).

- [ ] **Step 6: Dry-run smoke test locally (no writes, no email)**

Build first, then run the CLI directly in dry-run against prod (reads live state, writes nothing):

Run:

```bash
npm run build
COOLIFY_BASE_URL=http://coolify-1.devonwatkins.com \
COOLIFY_API_TOKEN="$(bws secret list 2>/dev/null | python3 -c "import sys,json;print(next((s['value'] for s in json.load(sys.stdin) if s['key']=='prod-coolify-api-token'),''))")" \
node dist/cli/remediate-cli.js --instance prod --dry-run
```

Expected: prints a remediation markdown digest to stdout; the "Auto-applied" entries all say `dry-run (would apply)`; no PATCH is performed. (If you lack a local BWS token, skip this step and rely on the launchctl smoke test in Task 12.)

- [ ] **Step 7: Commit**

```bash
git add scripts/drift-audit.sh
git commit -m "feat: chain remediate step into drift-audit.sh with consolidated email + combined heartbeat"
```

---

## Task 11: Move the schedule to 03:00 and document

**Files:**

- Modify: `scripts/com.devon.infra-drift.plist.template`
- Modify: `scripts/README.md`

- [ ] **Step 1: Change the launchd hour to 3**

In `scripts/com.devon.infra-drift.plist.template`, find the `StartCalendarInterval` block's `<key>Hour</key>` and change the following `<integer>7</integer>` to `<integer>3</integer>`.

- [ ] **Step 2: Verify the plist template is still well-formed XML**

Run: `plutil -lint scripts/com.devon.infra-drift.plist.template`
Expected: `... OK` (plutil lints templates fine as long as the XML is valid; if the template uses a placeholder token that breaks linting, instead grep-confirm the change: `grep -A1 Hour scripts/com.devon.infra-drift.plist.template` shows `<integer>3</integer>`).

- [ ] **Step 3: Update `scripts/README.md`**

Update the doc to reflect the new pipeline. Replace the "What runs" section's daily-time and step list, and add the new artifacts + change-manager note. Concretely:

- Change "daily 07:00" → "daily 03:00".
- After the audit bullet (writes `<date>.json`/`<date>.md`), add:

```markdown
4. **Remediate** (`remediate-cli.js`): re-audits live, auto-applies `safe`
   remediations (idempotent re-check before each write; never more than
   `MAX_AUTO_APPLIES`, default 20), and asks Sonnet (`claude-sonnet-4-6`) to
   write a remediation plan for every `caution`/`destructive`/`question` item.
   Writes `~/infra-drift/reports/<date>.remediation.json` (machine record +
   the `escalations` change-manager contract) and `<date>.remediation.md`.
5. Emails the **consolidated** digest (`<date>.remediation.md`), falling back to
   the raw audit `<date>.md` if the remediation step hard-failed.
6. Pings Healthchecks.io; healthy only if audit AND remediate both succeed.
```

- Add to the secrets list that `ANTHROPIC_API_KEY` is now fetched by-name from BWS (used only for plan generation; the deterministic safe-apply path needs no model).
- Add a "Dry run" line:

```markdown
Preview without writing or emailing:
`node dist/cli/remediate-cli.js --instance prod --dry-run`
```

- Add a short "Future: change manager" note: the `escalations` array in
  `<date>.remediation.json` is a stable, versioned contract for a later
  change-manager process that implements the hard fixes during change windows.

- [ ] **Step 4: Commit**

```bash
git add scripts/com.devon.infra-drift.plist.template scripts/README.md
git commit -m "feat: move drift pipeline to 03:00; document remediate step + change-manager contract"
```

---

## Task 12: Full verification + final build

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all tests pass — the pre-existing suite plus `executor`, `remediation-plan`, `remediation-report`, `run-remediation`, `remediate-cli`. Note the new total count.

- [ ] **Step 3: Confirm the built CLI exists and dry-runs from `dist/`**

Run: `node dist/cli/remediate-cli.js --help 2>/dev/null || node dist/cli/remediate-cli.js --instance prod --dry-run --report-dir /tmp/nope 2>&1 | head -5`
Expected: it executes (may error on missing Coolify env, which is fine — it proves the module loads and wires up). With real prod env it prints the digest and writes nothing under `--dry-run`.

- [ ] **Step 4: Final sweep — no stray `console.log`, no `.only` in tests**

Run: `grep -rn "\.only(" tests/ ; grep -rn "console.log" src/standards/remediation-plan.ts src/standards/executor.ts src/standards/run-remediation.ts || echo "clean"`
Expected: `clean` (no test `.only`, no stray debug logging).

- [ ] **Step 5: Push and open the PR (only if Devon asks)**

Do not push or open a PR unless instructed. When asked:

```bash
git push -u origin feat/remediation-pipeline
gh pr create --title "feat: daily remediation pipeline (auto-fix safe drift, package the rest for review)" --body "Implements docs/superpowers/specs/2026-06-13-remediation-pipeline-design.md. See plan docs/superpowers/plans/2026-06-13-remediation-pipeline.md."
```

---

## Post-implementation (operational, on the Mac mini — Devon runs these)

These are environment steps, not code, and require the mini + BWS access. List them for Devon; do not attempt them from CI:

1. Add `ANTHROPIC_API_KEY` to BWS (the by-name key the script fetches).
2. `bash scripts/install-drift-launchd.sh` to re-render and reload the LaunchAgent at the new 03:00 time.
3. `launchctl start com.devon.infra-drift` once to verify a full live run; `tail -f ~/Library/Logs/infra-drift.log`.
4. Confirm `~/infra-drift/reports/<date>.remediation.{json,md}` were written and the consolidated email arrived.

---

## Self-Review (completed by plan author)

- **Spec coverage:** data flow (Task 8 + 10), executor whitelist/idempotency/dry-run/failure-isolation (Tasks 2–3), runaway guard (Tasks 3, 8), Sonnet plans + raw fallback (Tasks 4–5), versioned `escalations` contract + digest (Tasks 6–7), CLI + exit codes (Task 9), shell chain + consolidated email + combined heartbeat (Task 10), 03:00 + docs + BWS key (Tasks 1, 10, 11), testing strategy (every task is test-first). All spec sections map to tasks.
- **Type consistency:** `ApplyResult`, `RemediationPlan`/`PlanModelSchema`, `Escalation`, `RemediationReport`, `RemediationDeps` are each defined once and imported thereafter; `applyAction(p, instance, opts)` signature is identical across executor, run-remediation, and CLI; `auditInstance`/`AuditResult`/`proposalIdentity`/`DriftReport` are reused from existing modules unchanged.
- **Placeholders:** none — every code step is complete and runnable.
- **Known soft spot:** the exact `@anthropic-ai/sdk` `messages.parse` + `zodOutputFormat` surface depends on the installed SDK version (Task 5 Step 5 flags the adjustment if types differ); and the BWS key name for the Anthropic key must be confirmed on the mini (Task 10 Step 1).
