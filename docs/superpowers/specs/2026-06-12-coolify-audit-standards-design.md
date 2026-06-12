# `coolify_audit_standards` — Tool Design Spec

**Date:** 2026-06-12 (rev. 2 — adopts infra-brain REST API + structured `check`)
**Status:** Draft (ready to implement)
**Version:** infraops-mcp-server 3.3.0 → 3.4.0 (additive: one new read-only tool + an infra-brain client + a standards engine)
**Parent:** `2026-06-12-discovery-proposal-queue-design.md`
**Companion:** `docs/superpowers/plans/2026-06-12-standards-audit-implementation.md` (cross-repo build plan)

## Overview

Add a single, **stateless, read-only** tool — `coolify_audit_standards` — that scans live Coolify resources and returns a list of **proposals**: deviations from infra-brain standards, each paired with a concrete, executable `planned_action` (an existing infraops write-tool + validated args). The tool **never mutates anything**.

The standards are **not embedded in infraops.** They are fetched at audit time from **infra-brain's new `GET /api/rules` REST endpoint**, where each rule may carry a structured `check` describing its assertion. infraops holds only the *mechanism*: how to read the live field, how to evaluate the assertion, and which write-tool remediates it. A local last-known-good cache plus an embedded seed make the audit degrade gracefully if infra-brain is unreachable.

This follows the shape of the existing `coolify_find_issues` tool in `src/tools/diagnostics.ts`, extended from "is it unhealthy?" to "does it conform to the standards infra-brain declares, and how would we fix it?".

## Decisions

- **infra-brain is the source of truth for *what* the standard is.** infraops fetches rules over REST (`GET /api/rules?category=coolify`); each rule's optional `check` field is the machine-readable assertion. (See parent spec's "standards contract" section.)
- **infraops owns *how* to observe and remediate.** A `check` never names an infraops tool. It carries a semantic `remediation_key`; infraops' **remediation registry** maps that key → `{ tool, risk, buildArgs }`. This keeps infra-brain decoupled from infraops' tool surface and lets infraops (which alone knows tool danger) own the `risk` rating.
- **Graceful degradation, not hard dependency.** Fetch order: live infra-brain → local cache (`~/.infraops/standards-cache.json`) → embedded seed (`src/standards/seed-checks.ts`). The output's `meta.standards_source` reports which was used so a degraded run is never silently mistaken for a fresh one.
- **Read-only.** `readOnlyHint: true`. The tool emits proposals; it does not apply them. `planned_action` is data, not a call.
- **Deterministic only (Phase 1).** No LLM. Every check is a pure assertion over a live Coolify object. Reproducible and testable; cheap enough to run on a schedule. Prose-only rules (no `check`) are counted in `meta.not_audited` but not evaluated.
- **Coolify-only scope.** Cross-provider checks (orphan DNS) are the sibling tool `audit_dns_orphans` (Phase 1.5).

## Files (infraops side)

| File | Change |
|---|---|
| `src/services/infrabrain-client.ts` | **New.** Axios singleton to infra-brain; `x-brain-key` header auth; `infrabrainGet()`, `handleInfrabrainError()`, `isInfrabrainConfigured()`. Mirrors `hetzner-client.ts`. |
| `src/standards/check-engine.ts` | **New.** Types (`StandardCheck`, `Proposal`) + the pure assertion evaluator (`evaluateCheck(check, resource, ctx)` → deviation or null) + the op set. |
| `src/standards/remediation-registry.ts` | **New.** `remediation_key` → `{ tool, risk, buildArgs(resource) }`. The only place infraops tool names appear in this feature. |
| `src/standards/seed-checks.ts` | **New.** Embedded offline-fallback copy of the Coolify checks (same shape infra-brain returns). |
| `src/standards/standards-source.ts` | **New.** `loadCoolifyChecks(instance)` → fetch live → cache → seed, returning `{ checks, source }`. Owns the cache file read/write. |
| `src/tools/audit.ts` | **New.** `registerAuditTools(server)` — registers `coolify_audit_standards`. Fans out live reads, runs checks, returns proposals. Mirrors `diagnostics.ts`. |
| `src/index.ts` | Add `import { registerAuditTools } from "./tools/audit.js";` and call it right after `registerDiagnosticTools(server);` (line ~112). |
| `server/start.sh` & `.mcp.json` | Add `INFRABRAIN_BASE_URL` (default `https://infra-brain.devonwatkins.com`) and `INFRABRAIN_ACCESS_KEY` (from BWS — same value as infra-brain's `MCP_ACCESS_KEY`). |
| `tests/audit.test.ts` | **New.** Vitest; mocks `infrabrain-client` + `coolify-client`; covers eval ops, remediation mapping, degrade path, scope/category filters. |
| `package.json` | Version bump 3.3.0 → 3.4.0. |

## The check + proposal types (`src/standards/check-engine.ts`)

```typescript
export type Op =
  | "eq" | "neq" | "contains" | "not_contains"
  | "present" | "absent" | "empty" | "non_empty"
  | "starts_with" | "not_starts_with" | "matches";

export interface Assertion { field: string; op: Op; value?: unknown; }

// Exactly the shape infra-brain returns in Rule.check (plus the rule's id/severity/text, carried alongside).
export interface StandardCheck {
  rule_id: number;                 // infra-brain Rule.id (for provenance)
  rule_text: string;               // the human sentence, used in `reasoning`
  severity: "BLOCK" | "WARN" | "INFO";
  schema_version: number;
  resource: "coolify_application" | "coolify_database";
  assert: Assertion;
  when?: Assertion;                // optional precondition; skip rule if false
  remediation_key?: string;        // semantic; resolved by the remediation registry
  kind: "remediation" | "question";
}

export type Risk = "safe" | "caution" | "destructive";
export type Confidence = "high" | "medium" | "low";

export interface PlannedAction { tool: string; args: Record<string, unknown>; }

export interface Proposal {
  id: string;                      // `${remediation_key ?? rule_id}:${uuid}`
  kind: "remediation" | "question";
  source: "standards-audit";
  status: "pending";
  target: { provider: "coolify"; resource_type: string; uuid: string; name: string };
  description: string;
  reasoning: string;               // cites rule_text + rule_id + severity
  confidence: Confidence;          // Phase 1: "high" for deterministic checks
  risk: Risk;                      // from the remediation registry; "safe" for pure questions
  planned_action: PlannedAction | null;
  question: string | null;
}

// Pure: returns a Proposal when the resource VIOLATES the check, else null.
export function evaluateCheck(
  check: StandardCheck,
  resource: Record<string, unknown>,
  resolveRemediation: (key: string, res: Record<string, unknown>) =>
    { action: PlannedAction; risk: Risk } | null,
): Proposal | null;
```

**Operator semantics** (keep them total and boring): `eq/neq` strict; `contains/not_contains` substring on the string-coerced field; `present/absent` key existence + non-null; `empty/non_empty` for arrays/strings (length); `starts_with/not_starts_with` string prefix; `matches` anchored RegExp from `value`. Unknown op → treat as "cannot evaluate", skip, and record in `meta.skipped` (never throw).

## The remediation registry (`src/standards/remediation-registry.ts`)

```typescript
import type { PlannedAction, Risk } from "./check-engine.js";

interface Remediation {
  tool: string;
  risk: Risk;
  buildArgs: (res: Record<string, unknown>) => Record<string, unknown>;
}

export const REMEDIATIONS: Record<string, Remediation> = {
  "coolify.enable_healthcheck": {
    tool: "coolify_update_application",
    risk: "safe",
    buildArgs: (a) => ({
      uuid: a.uuid,
      health_check_enabled: true,
      health_check_path: "/api/health",
      health_check_start_period: 15,
    }),
  },
  "coolify.force_https": {
    tool: "coolify_update_application",
    risk: "caution",
    // rewrite http:// → https:// on the existing fqdn
    buildArgs: (a) => ({ uuid: a.uuid, domains: String(a.fqdn).replace(/^http:\/\//, "https://") }),
  },
  // "coolify.enable_db_backup": deferred — Coolify backup args unconfirmed; checks for it stay kind:"question"
};

export function resolveRemediation(key: string, res: Record<string, unknown>):
  { action: PlannedAction; risk: Risk } | null {
  const r = REMEDIATIONS[key];
  if (!r) return null;
  return { action: { tool: r.tool, args: r.buildArgs(res) }, risk: r.risk };
}
```

> Only real `coolify_update_application` params are used — `health_check_enabled`, `health_check_path`, `health_check_start_period`, `domains` (confirmed in `src/tools/applications.ts:766-805`). The tool does **not** expose health-check host/interval/timeout/retries; the proposal's `reasoning` notes those remain UI-only. Never emit args a tool can't accept.

## Standards source with fallback (`src/standards/standards-source.ts`)

```typescript
export async function loadCoolifyChecks(): Promise<{ checks: StandardCheck[]; source: "live" | "cache" | "seed" }> {
  if (isInfrabrainConfigured()) {
    try {
      const { rules } = await infrabrainGet<{ rules: RawRule[] }>("/api/rules", { category: "coolify" });
      const checks = rules.filter((r) => r.check).map(toStandardCheck);
      writeCache(checks);                       // ~/.infraops/standards-cache.json (best-effort)
      return { checks, source: "live" };
    } catch { /* fall through */ }
  }
  const cached = readCache();
  if (cached) return { checks: cached, source: "cache" };
  return { checks: SEED_CHECKS, source: "seed" };
}
```

The cache file is a *cache*, not the persistent queue of the parent proposal — it holds only the latest standards, is safe to delete, and never stores infrastructure state.

## Tool handler (`src/tools/audit.ts`)

Mirrors `coolify_find_issues`: fan out live reads with `Promise.allSettled`, load checks, evaluate, return JSON.

```typescript
server.registerTool("coolify_audit_standards", {
  title: "Audit Coolify Resources Against Standards",
  description:
    "Scan all (or one) Coolify application and database against infra-brain standards " +
    "(fetched from infra-brain's REST API; cached fallback). Returns proposals — each a " +
    "deviation paired with a concrete remediation tool-call. Read-only: applies nothing.",
  inputSchema: {
    scope: z.string().optional().describe("Optional app/db name or UUID to limit the audit to one resource"),
    categories: z.array(z.string()).optional().describe("Optional check categories to include (default: all)"),
    now: z.string().optional().describe("ISO timestamp for age-based checks; caller supplies for determinism"),
    instance: CoolifyInstanceSchema,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ scope, categories, now, instance }) => {
  const { checks, source } = await loadCoolifyChecks();
  const [appsRes, dbsRes] = await Promise.allSettled([
    coolifyGet<CoolifyApp[]>("/applications", undefined, instance),
    coolifyGet<CoolifyDatabase[]>("/databases", undefined, instance),
  ]);
  // extract() helper identical to diagnostics.ts; collect errors
  // filter resources by `scope`; partition checks by resource type; apply `categories`
  const proposals: Proposal[] = [];
  for (const app of apps ?? [])
    for (const c of appChecks) { const p = evaluateCheck(c, app, resolveRemediation); if (p) proposals.push(p); }
  for (const db of dbs ?? [])
    for (const c of dbChecks)  { const p = evaluateCheck(c, db, resolveRemediation);  if (p) proposals.push(p); }

  const output = {
    meta: {
      standards_source: source,                 // "live" | "cache" | "seed"
      checks_evaluated: checks.length,
      not_audited: /* count of coolify rules with no `check` */,
      ...(errors.length > 0 && { errors }),
    },
    summary: {
      total_proposals: proposals.length,
      by_risk: { safe: n, caution: n, destructive: n },
      by_kind: { remediation: n, question: n },
    },
    proposals,
  };
  return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
});
```

## Example output

```json
{
  "meta": { "standards_source": "live", "checks_evaluated": 3, "not_audited": 4 },
  "summary": { "total_proposals": 2, "by_risk": { "safe": 1, "caution": 0, "destructive": 0 }, "by_kind": { "remediation": 1, "question": 1 } },
  "proposals": [
    {
      "id": "coolify.enable_healthcheck:r8oskgcw004kk8wkgkgkc4s0",
      "kind": "remediation", "source": "standards-audit", "status": "pending",
      "target": { "provider": "coolify", "resource_type": "application", "uuid": "r8oskgcw004kk8wkgkgkc4s0", "name": "booking-assistant" },
      "description": "Application 'booking-assistant' (running) has health checks disabled.",
      "reasoning": "infra-brain rule #12 (WARN): health checks must be enabled on production apps. Note: host/interval/timeout/retries are not settable via coolify_update_application and must be set in the Coolify UI.",
      "confidence": "high", "risk": "safe",
      "planned_action": { "tool": "coolify_update_application", "args": { "uuid": "r8oskgcw004kk8wkgkgkc4s0", "health_check_enabled": true, "health_check_path": "/api/health", "health_check_start_period": 15 } },
      "question": null
    },
    {
      "id": "18:vh6rmgm6wrn8c1owl7tjcbkn",
      "kind": "question", "source": "standards-audit", "status": "pending",
      "target": { "provider": "coolify", "resource_type": "database", "uuid": "vh6rmgm6wrn8c1owl7tjcbkn", "name": "crm-db" },
      "description": "Database 'crm-db' (running) has no backup configured.",
      "reasoning": "infra-brain rule #18 (WARN): production databases require scheduled backups.",
      "confidence": "high", "risk": "safe", "planned_action": null,
      "question": "Database 'crm-db' has no backup configured. Add a nightly backup?"
    }
  ]
}
```

## Determinism note

infraops handlers run in a normal Node process, so `Date.now()` / `new Date()` are available (unlike Workflow scripts). For age-based checks, prefer the caller-supplied `now`; fall back to `new Date().toISOString()`. Tests always pass an explicit `now`.

## Testing (`tests/audit.test.ts`)

Follow the Vitest pattern in `tests/services.test.ts`: `vi.mock` both `../src/services/infrabrain-client.js` and `../src/services/coolify-client.js`; register the tool against a mock server; invoke `_handlers["coolify_audit_standards"]`.

- **Eval ops:** `eq` violation fires, conformance doesn't; `empty`/`non_empty` on `backup_configs`; `starts_with` on `fqdn: "http://"`; `when` precondition gates a check off for a stopped app.
- **Remediation mapping:** a check with `remediation_key: "coolify.enable_healthcheck"` produces `kind:"remediation"` with exact `planned_action.args`; an unknown key degrades to `kind:"question"`, `planned_action:null`.
- **Risk:** comes from the registry, not the rule severity (`force_https` → `caution`).
- **Degrade path:** infra-brain mock rejects → `meta.standards_source` becomes `"cache"`, then `"seed"` when no cache; proposals still computed from seed.
- **Filters:** `scope` limits to one resource; `categories` filters checks; `meta.not_audited` counts prose-only rules.
- **Resilience:** a rejected `/databases` read surfaces in `meta.errors` and does not abort the app audit; an unknown op is skipped, not thrown.

## Out of scope (deferred)

- Persistence / snooze / suppress-already-handled (Phase 2 — distinct from the standards cache).
- Cross-provider orphan-DNS → `audit_dns_orphans` (Phase 1.5).
- LLM judging of prose-only rules (Phase 3).
- Applying proposals — the existing write-tools do that after human review.
- Over-scoped-BWS-token detection — infraops reads env *keys* only, not values; needs a different signal.
