# Discovery / Analyzer Proposal Queue — Design Proposal

**Date:** 2026-06-12
**Status:** Proposal (Draft)
**Version:** infraops-mcp-server 3.3.0 (targets a future minor/major)
**Origin:** Salvaged concept from the retired **InfraManager** project (archived 2026-06-12). The discovery/analyzer "proposals queue" was InfraManager's one genuinely novel feature not yet replicated in infraops or the brains.

## Overview

Port InfraManager's best idea — _automatic detection → human-reviewed proposal → applied change_ — into infraops, but **reframe what it diffs**.

InfraManager reconciled a hand-maintained JSON catalog against itself, and that catalog is exactly what went stale and killed the project (it sat `exited:unhealthy` for months with zero consumers). infraops has no catalog and doesn't need one: it reads **live infrastructure** directly. So the proposal queue becomes a diff between:

- **Actual state** — live provider state (what infraops already reads via `coolify_list_*`, `cloudflare_list_*`, `namecheap_dns_get_hosts`, …), and
- **Intended state** — documented standards (**infra-brain**) plus app intent (**app-brain**),

with each proposal carrying a concrete, _executable_ infraops remediation call.

This closes a loop that is currently open. Today infraops can **detect** problems (`coolify_find_issues`, `coolify_diagnose_*`) and **fix** them (`coolify_update_application`, `namecheap_dns_delete_record`, …), but nothing connects detection to a reviewable, standards-aware queue of fixes. That connection is the feature.

## The key reframing (why this is not a straight port)

|                            | InfraManager                                  | infraops version                                       |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| Source of "actual" state   | A JSON catalog on disk (drifted → went stale) | Live provider APIs (always current)                    |
| Source of "intended" state | The same catalog (self-referential)           | **infra-brain** standards + **app-brain** app intent   |
| A proposal proposes…       | Editing a catalog entry (safe, reversible)    | Changing **real infrastructure** (higher blast radius) |
| Approving a proposal…      | Mutated a JSON file                           | Executes a real infraops write-tool                    |
| The analyzer's LLM job     | Infer infra deps from a repo                  | Infer deviations from standards + remediation plans    |

The elegant consequence: **infraops never rebuilds InfraManager's catalog — the catalog is what rotted.** The "intended state" already lives in infra-brain and app-brain; the "actual state" is live; the proposal queue is just the diff; and the remediation actions are tools infraops already has. This is the fusion the three-MCP architecture was always implying but never wired together.

## Decisions

- **No persistent infrastructure model.** infraops stays stateless. The queue is the materialized diff of three live-readable sources, not a stored mirror.
- **Start stateless (Phase 1).** The first deliverable computes proposals fresh on each call and returns them; the _agent_ (Claude) is the review loop. Persistence (snooze/suppress/history) is added only if living with Phase 1 proves it's needed.
- **Proposals are executable, not advisory.** Each proposal carries a `planned_action` = a named infraops tool + validated args, ready to dry-run and execute. This turns the queue from a report into a control plane.
- **Standards come from infra-brain over a new REST read-API — single source of truth.** Since we own infra-brain, we give it a plain `GET /api/rules` HTTP endpoint (_not_ MCP, _not_ direct DB) backed by its existing `RuleRepository`, and extend its `Rule` model with an optional structured `check` field so rules become machine-evaluable, not just prose. infraops fetches these at audit time via a thin HTTP client, **caching last-known-good locally** so a momentary infra-brain outage degrades gracefully rather than failing the audit. Division of labor: **infra-brain owns WHAT the standard is** (value + structured assertion + severity); **infraops owns HOW to observe the live value and HOW to remediate** (provider mechanics + which write-tool fixes it). A small embedded seed copy of the checks ships inside infraops purely as an _offline fallback_, not the source of truth.
  - _Why not embed in code?_ Duplicates the standard and silently drifts when infra-brain changes. _Why not MCP?_ MCP servers can't call each other; making infraops an MCP client of infra-brain is heavy machinery. _Why not direct DB?_ Reaches past infra-brain's API into its private schema. A thin REST surface over the shared repository layer is the clean third path.
- **Never auto-apply.** Approval mutates real infrastructure. Every proposal requires explicit human (or explicitly-authorized agent) approval, gated by a `risk` field.

## The state problem (where a future queue would live)

infraops is deliberately stateless — a stdio pass-through, no DB, no cache. A durable queue implies persistence. Options, for the record:

| Option                          | Where the queue lives                                          | Pros                                                       | Cons                                                                                             |
| ------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **A. Stateless / ephemeral** ⭐ | Nowhere — tool computes proposals fresh; the agent is the loop | Zero architectural change; always reflects current reality | No cross-session memory; can't snooze/suppress                                                   |
| **B. Local persisted store**    | SQLite/JSON under `~/.infraops/` (infraops runs on the Mac)    | Durable; track accept/reject/snooze; dedupe re-runs        | Adds a persistence layer + a file to secure; no longer purely stateless                          |
| **C. Fold into infra-brain**    | A new "proposals" namespace beside rules/lessons               | Reuses an already-stateful service                         | infra-brain is read-mostly standards, not a task queue — semantic mismatch; couples two services |

**Recommendation: ship A; add B only if it earns it.**

## Proposal data model (adapted)

Keep InfraManager's clean shape; add the two fields that make it safe in a live-infra context — `planned_action` (the exact tool-call) and `risk`:

```
Proposal {
  id            string
  kind          "remediation" | "create" | "delete" | "question"
  source        "standards-audit" | "repo-analyzer" | "drift-check"
  status        "pending" | "approved" | "rejected" | "snoozed"   // Phase 1: always "pending"
  target        { provider, resource_type, uuid, name }            // what it's about
  description   string        // "BookingAssistant prod has health checks disabled"
  reasoning     string        // "infra-brain standard: health checks enabled on production apps"
  confidence    "high" | "medium" | "low"
  risk          "safe" | "caution" | "destructive"                 // gates approval
  planned_action {                                                  // executable, not prose
    tool: "coolify_update_application",
    args: { uuid: "...", health_check_enabled: true, ... }
  } | null
  question      string | null   // for kind=question
}
```

## The standards contract (infra-brain ↔ infraops)

The audit is a comparison, so the standard must arrive in a machine-evaluable shape. infra-brain's `Rule` rows are prose today (`rule` is a free-text sentence). We extend the model with an optional **`check`** JSON field that carries the assertion — the _declarative WHAT_, with no infraops tool names in it:

```jsonc
// infra-brain Rule.check (JSONB, nullable). null = prose-only rule (advisory, not auto-audited).
{
  "schema_version": 1,
  "resource": "coolify_application", // which live resource this applies to
  "assert": { "field": "health_check_enabled", "op": "eq", "value": true },
  "when": { "field": "status", "op": "contains", "value": "running" }, // optional precondition
  "remediation_key": "coolify.enable_healthcheck", // optional, semantic — NOT a tool name
  "kind": "remediation", // or "question" (default when no remediation_key)
}
```

infraops holds the _HOW_ in a **remediation registry** keyed by `remediation_key`:

```ts
// infraops: remediation_key → how to fix it. Keeps tool names out of infra-brain.
"coolify.enable_healthcheck": {
  tool: "coolify_update_application",
  risk: "safe",
  buildArgs: (app) => ({ uuid: app.uuid, health_check_enabled: true,
                         health_check_path: "/api/health", health_check_start_period: 15 }),
}
```

So infra-brain names the _intent_; infraops names the _tool_ and declares the action's `risk` (it alone knows which tools are destructive). Rules whose `check` is `null` stay prose-only — infraops surfaces a count of them as "not auto-audited" (no silent caps) but can't evaluate them deterministically; those are candidates for the Phase 3 LLM judge.

## How analysis works

Two generators, both producing the same `Proposal` shape:

1. **Standards-audit (rules-first, highest value).** Diff live Coolify/Cloudflare/Namecheap state against infra-brain standards **fetched over its REST API** (with a local cache fallback). Mostly deterministic — health-check config, HTTPS, restart policy, backup gaps, orphan DNS. LLM optional, only for fuzzy "does this match app-brain's description?" cases. _Phase 1 implements the Coolify slice of this — see the companion spec `2026-06-12-coolify-audit-standards-design.md`._
2. **Repo-analyzer (LLM-first, the InfraManager original).** Point at a GitHub repo (infraops already has `github_*`), fetch `.env.example`/manifests/compose/sample source, and have Claude infer required secrets, implied services, deployment flavor, and missing pieces → onboarding proposals. _Phase 3._

## The approval / safety model (non-negotiable)

InfraManager could approve freely — worst case, a wrong link in a JSON file. Here, approve **mutates real infrastructure**:

1. **Never auto-apply.** Human/authorized-agent approves each proposal.
2. **`risk` gates the path:** `safe` → one-step approve; `caution` → show diff first; `destructive` (delete DNS, delete app) → typed confirmation, never batch.
3. **Dry-run by default.** Approve = preview the exact tool-call + args; a second confirm executes.
4. **Idempotency check at execution.** Re-read live state before applying — the proposal may be stale.
5. **Audit trail** of what was applied (stdout/transcript even in stateless mode).

## Example use cases (grounded in the portfolio)

1. **Orphan DNS** — _exactly what was found manually on 2026-06-12._ `infra.devonwatkins.com` pointed at a Coolify UUID with no matching app → _"Proposal: `namecheap_dns_delete_record`."_ (Cross-provider; Phase 1.5 sibling tool.)
2. **Over-scoped secret** — _the other thing that bit us._ An app carrying a full-vault `BWS_ACCESS_TOKEN` → _"Standard requires scoped service accounts. Proposal: flag + rotate."_
3. **Stale stopped app** — InfraManager itself sat `exited:unhealthy` for months → _"Stopped >30d, zero consumers. Proposal: retire."_
4. **Health-check drift** — _"N prod apps have health checks disabled. Proposal: `coolify_update_application` ×N."_
5. **Missing HTTPS** — _"App served http-only; standard requires HTTPS. Proposal: set FQDN to https."_
6. **Flavor mismatch** — _"app-brain says REDealEngine is Flavor B (Postgres) but no DB resource is linked. Proposal: investigate / `coolify_create_database`."_
7. **Backup gap** — _"crm-db has empty `backup_configs`; backup procedure requires nightly. Proposal: `coolify_create_scheduled_task`."_
8. **New-project onboarding** — repo-analyzer infers _"needs Postgres + 6 secrets + Flavor B"_ → scaffold proposal.
9. **Scheduled portfolio audit** — a weekly `/schedule` cloud agent runs the audit; deviations are reviewed in a batch instead of discovered by accident months later.

## Pros & Cons

**Pros**

- Closes the detect→propose→remediate loop infraops half-has today.
- Catches precisely the failure class that just cost a cleanup — orphan DNS, over-scoped tokens, stale apps, undocumented drift.
- Makes infra-brain standards _enforceable_, not just documented.
- Proposals reuse existing infraops write-tools as remediation — little new surface area.
- Naturally fuses all three MCP servers (live state + standards + app intent).
- Phase 1 fits the stateless design — no DB, no daemon, no rot risk.

**Cons / Risks**

- Approval mutates real infrastructure — far higher blast radius than InfraManager's catalog edits; demands the safety model above.
- Persistence (Phase 2) breaks the clean stateless design and adds a local state file to secure.
- LLM inference is fallible → wrong proposals; mitigated by confidence scoring + mandatory human-in-loop + dry-run.
- Standards must be diff-able — prose rules can't be auto-evaluated, so each Coolify standard needs a structured `check` authored in infra-brain (one-time backfill + ongoing discipline when adding rules).
- Adds a runtime dependency: the audit calls infra-brain. _Mitigated_ by a local last-known-good cache + an embedded seed fallback, so an outage degrades rather than fails.
- Scope creep — infraops risks becoming a "platform" that rots from disuse (InfraManager is the cautionary tale). _Mitigation: ship Phases 0–1 only; let usage justify each later phase._

## Recommended rollout

| Phase   | Deliverable                                                                                                                                                                                                                    | State?                | Value                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------- |
| **0**   | **infra-brain**: add `check` JSONB column (+ Alembic migration), `GET /api/rules` REST endpoint, seed the Coolify structured checks. Ships first — infraops depends on it.                                                     | Postgres (existing)   | Single source of truth for standards         |
| **1**   | **infraops**: `coolify_audit_standards` — stateless tool: fetches checks from infra-brain (local cache fallback), diffs live Coolify state, returns proposals with `planned_action` + `risk`. No persistence, no auto-execute. | Local cache only      | ~80% of value                                |
| **1.5** | `audit_dns_orphans` — cross-provider: correlate Namecheap DNS vs live Coolify/Cloudflare targets                                                                                                                               | None                  | Catches the orphan-DNS class directly        |
| **2**   | Local persisted queue (snooze / suppress-handled / decision history)                                                                                                                                                           | SQLite `~/.infraops/` | Quality-of-life; only if Phase 1 proves used |
| **3**   | `repo_analyze` — LLM repo → onboarding proposals (the InfraManager original)                                                                                                                                                   | Stateless             | New-project scaffolding                      |
| **4**   | Scheduled weekly audit via `/schedule` cloud agent                                                                                                                                                                             | —                     | Proactive, batched review                    |

## Open questions

- ~~Should standards live as code or be pulled from infra-brain?~~ **Resolved:** infra-brain REST API + structured `check` field; infraops caches + keeps an embedded seed fallback. See the standards-contract section and the implementation plan `docs/superpowers/plans/2026-06-12-standards-audit-implementation.md`.
- Should infra-brain's `GET /api/rules` reuse the existing `mcp_access_key` (one shared secret for MCP + REST), or get a separate read-only token? (Plan starts with the shared key for simplicity.)
- For Phase 2 persistence: local SQLite vs. folding into infra-brain — decide when the snooze/suppress need is concrete.
- Where does the human actually review the queue — purely in the Claude Code conversation, or does a thin read-only UI eventually earn its place? (InfraManager's UI had no consumers; resist rebuilding it without demand.)
