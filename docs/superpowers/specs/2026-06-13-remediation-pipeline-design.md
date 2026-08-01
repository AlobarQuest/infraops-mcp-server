# Remediation Pipeline — Design

**Date:** 2026-06-13
**Status:** Approved (design)
**Version:** infraops-mcp-server (targets a future minor)
**Origin:** Downstream consumer of the daily drift audit shipped in #11
(`feat: schedule daily drift audit on the mini via launchd`). Realises the
"downstream remediation-planner" the audit's `scripts/README.md` anticipated and
the detect→propose→**remediate** loop sketched in
[`2026-06-12-discovery-proposal-queue-design.md`](./2026-06-12-discovery-proposal-queue-design.md).

## Overview

The daily drift audit ([`src/cli/audit-cli.ts`](../../../src/cli/audit-cli.ts))
writes `~/infra-drift/reports/<date>.json` — a list of standards **proposals**,
each already classified by `risk` (`safe`/`caution`/`destructive`) and `kind`
(`remediation`/`question`), and each `remediation` carrying an executable
`planned_action` (exact infraops tool + validated args).

This piece — the **remediation pipeline** — consumes that report and closes the
loop two ways:

- **`safe` remediations** are applied autonomously by a **deterministic runner**
  (no LLM in the write path), after re-validating against live state.
- **Everything harder** (`caution`/`destructive` remediations + all `question`
  proposals) is **escalated**: turned into a rich, Sonnet-written remediation
  plan and bundled into a **stable handoff package** for human review now and,
  eventually, an automated **change manager** (see Future Consumers).

One consolidated email reports what was auto-fixed and what needs attention.

The whole pipeline is chained into the existing `drift-audit.sh` launchd job so
the daily run becomes **audit → remediate → one email**, starting at **03:00**
(moved earlier than the audit's original 07:00 to leave a wide buffer before the
operator's morning).

## Decisions (locked during brainstorming)

1. **Autonomy: full closed loop, scoped to `safe` only.** The pipeline applies
   `safe` + `confidence=high` remediations unattended. `caution`, `destructive`,
   and all `question` proposals are _never_ auto-applied — they escalate. This
   intentionally narrows the proposal-queue spec's "never auto-apply" default to
   "auto-apply only the provably-safe, reversible class."
2. **Deterministic execution, no LLM in the write path.** The audit already
   computes the exact tool + args; applying them needs no judgment. A script
   iterates, re-validates, and calls the client layer directly. Reproducible,
   testable, cheap, no model nondeterminism against real infra.
3. **Sonnet writes the plans for escalated items.** Escalated proposals have no
   pre-computed action, so Sonnet turns each into a concrete remediation plan
   (root cause → steps → tools → risk → rollback → CM-window hint). This is
   advisory output only — it never executes.
4. **Housing: sibling CLI + shell chain (Approach A).** A new `remediate-cli.ts`
   next to `audit-cli.ts`, invoked by the same `drift-audit.sh`. Maximum reuse
   of the proven launchd + BWS + Healthchecks.io pattern; no new infrastructure.
5. **Re-audit live is the idempotency guard.** The runner acts on a fresh
   `auditInstance()` result, not the morning JSON, satisfying the spec's
   "re-read live state before applying" requirement.
6. **One consolidated email**, with raw-audit fallback if remediation hard-fails.

## Architecture & data flow

```
drift-audit.sh  (launchd com.devon.infra-drift, 03:00, Mac mini)
  │
  1. audit-cli.js   ── writes ~/infra-drift/reports/<date>.json + .md   (UNCHANGED)
  │
  2. remediate-cli.js --report-dir ~/infra-drift/reports --now <iso>
  │     a. load morning <date>.json            (work-list + provenance + delta context)
  │     b. RE-AUDIT LIVE via auditInstance()   ← authoritative current drift; idempotency
  │     c. split the LIVE set (morning report only annotates self_resolved/new):
  │           • safe + remediation + high conf  → APPLY
  │           • everything else                 → ESCALATE
  │     d. apply safe   (executor.ts: whitelisted, idempotent, per-item result)
  │     e. plan escalated  (remediation-plan.ts: Sonnet, best-effort, raw fallback)
  │     f. write <date>.remediation.json  +  <date>.remediation.md
  │
  3. email <date>.remediation.md   (fallback: <date>.md if step 2 hard-failed)
  4. Healthchecks.io ping  (combined rc = audit rc OR remediate rc)
```

**Why re-audit live rather than trust the morning JSON:** the morning report can
be minutes-to-hours stale. Re-running `auditInstance()` (two list calls per
instance — cheap) yields the authoritative current drift; we apply only what is
_still_ drifted. Reconciling against the morning report lets the digest report
self-resolution ("12 found at 03:00, 12 still drifted → fixed; 0 self-resolved").
The morning `<date>.json` remains the durable audit artifact and the email
fallback; the live re-audit is what we act on.

**Why one email:** today `drift-audit.sh` emails the raw audit `.md`. That moves
to the end of the chain so the operator gets a single message — what was fixed +
what needs them. If remediation hard-fails, the shell falls back to emailing the
raw audit `.md`, so a broken remediation step never leaves the operator blind.

## Components

| Component                                      | New/changed | Responsibility                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/standards/executor.ts`                    | **new**     | Whitelisted apply engine. A `SAFE_TOOLS` dispatch map (today: `coolify_update_application` → client PATCH). `applyAction(action, target)` enforces the four-gate check, performs the no-op idempotency re-fetch, calls the client, returns `{status: "applied"\|"skipped"\|"failed", detail}`. **The only place an autonomous write can originate.** |
| `src/standards/remediation-plan.ts`            | **new**     | Sonnet plan-gen for one escalated proposal → structured `RemediationPlan`. Best-effort: on API error returns a `raw` fallback. Never throws.                                                                                                                                                                                                         |
| `src/standards/remediation-report.ts`          | **new**     | Builds `<date>.remediation.json` (versioned contract) and renders `<date>.remediation.md` (email body). Mirrors `report.ts`.                                                                                                                                                                                                                         |
| `src/cli/remediate-cli.ts`                     | **new**     | Orchestrates a→f. Mirrors `audit-cli.ts` arg-parsing, `--report-dir`/`--now`/`--stdout`/`--dry-run` flags, exit-code semantics.                                                                                                                                                                                                                      |
| `scripts/drift-audit.sh`                       | **changed** | Add the remediate step; move email to the consolidated digest with raw-audit fallback; combine rc for the heartbeat; fetch `ANTHROPIC_API_KEY` from BWS by name.                                                                                                                                                                                     |
| `scripts/com.devon.infra-drift.plist.template` | **changed** | `StartCalendarInterval` `Hour` 7 → 3. Re-install via `install-drift-launchd.sh`.                                                                                                                                                                                                                                                                     |
| `scripts/README.md`                            | **changed** | Document the remediate step, the new artifacts, the dry-run smoke test, and the change-manager future consumer.                                                                                                                                                                                                                                      |
| BWS                                            | **changed** | Add `ANTHROPIC_API_KEY` (fetched by-name like the other secrets), used only by plan-gen.                                                                                                                                                                                                                                                             |

The `executor.ts` whitelist reuses the same `coolify-client` seam `auditInstance`
already uses — no new provider surface.

## Safety model

Defense in depth, outermost first:

1. **Four-gate apply.** Auto-apply requires `kind==="remediation"` **and**
   `risk==="safe"` **and** `confidence==="high"` **and** `tool ∈ SAFE_TOOLS`.
   Failing any gate routes the item to escalation. Adding a tool to `SAFE_TOOLS`
   is a deliberate human edit — the registry's `risk` tag alone does not grant
   auto-apply.
2. **Re-audit live before acting** (see data flow) — stale items can't be applied.
3. **No-op idempotency check.** Before each call, re-fetch the target and compare
   current fields to `planned_action.args`; if the write would change nothing,
   record `skipped` and make no call. Re-running the pipeline is always safe.
4. **Runaway guard.** `MAX_AUTO_APPLIES` (env, default **20**; today's load is
   12). If the live `safe` set exceeds it — the signature of a bad infra-brain
   rule flagging the whole fleet — the pipeline applies **nothing**, escalates
   the entire batch, and flags it loudly in the digest.
5. **Per-item isolation.** Each apply is wrapped; one failure records `failed`
   with the error and continues. It never aborts the batch or the escalation pass.
6. **Hard boundary on escalated items.** `caution`/`destructive`/`question` are
   never touched by the write path — only packaged. There is no code path from an
   escalated item to a live write.
7. **Dry-run mode.** `remediate-cli --dry-run` previews applies + escalations and
   writes nothing. For testing and manual "what would it do" runs. The launchd
   job runs without it.
8. **Graceful degradation.** Sonnet failure → raw-proposal fallback. infra-brain
   outage → the audit's existing cache/seed fallback. Any hard failure → non-zero
   rc → Healthchecks.io `/fail`, so a broken run alerts rather than silently
   doing nothing.
9. **Full audit trail.** Every action (`applied`/`skipped`/`failed`, with args
   and live-state detail) is written to `<date>.remediation.json` and the log —
   a complete nightly record despite infraops staying stateless.
   `ANTHROPIC_API_KEY` is used only by plan-gen and never logged.

Keystone: gates 1 + 6 mean the autonomous loop can _only ever_ enable health
checks (and whatever future genuinely-safe, reversible action is explicitly
whitelisted); everything else is physically incapable of auto-applying.

## Data contracts

### `<date>.remediation.json` (output)

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-06-13T07:00:05Z",
  "source_report": "2026-06-13.json",
  "totals": {
    "applied": 12,
    "skipped": 0,
    "failed": 0,
    "escalated": 3,
    "self_resolved": 0,
    "runaway_tripped": false,
  },
  "applied": [
    {
      "proposal_id": "coolify.enable_healthcheck:72f55467",
      "target": {
        "provider": "coolify",
        "resource_type": "application",
        "uuid": "...",
        "name": "AlobarQuest/github-to-bitbucket-mirror",
      },
      "tool": "coolify_update_application",
      "args": { "uuid": "...", "health_check_enabled": true, "...": "..." },
      "status": "applied", // applied | skipped | failed
      "detail": "health_check_enabled false → true",
    },
  ],
  "escalations": [
    // ← the change-manager input contract
    {
      "proposal_id": "572:e4f2022e",
      "target": {
        "provider": "coolify",
        "resource_type": "database",
        "uuid": "...",
        "name": "agent-sites-postgres",
      },
      "risk": "safe", // (question-kind; no planned_action)
      "kind": "question",
      "reasoning": "infra-brain rule #572 (WARN): databases must have backups",
      "plan": {
        "generated_by": "sonnet", // sonnet | raw (fallback)
        "root_cause": "...",
        "steps": ["..."],
        "infraops_tools": ["coolify_create_scheduled_task"],
        "risk": "caution",
        "rollback": "...",
        "cm_window_hint": "off-peak; backup job is additive/non-disruptive",
      },
    },
  ],
}
```

The `escalations` array is the **stable contract** the future change manager
consumes. Its shape is versioned (`schema_version`) and decoupled from the
audit's own proposal schema so the two can evolve independently.

### `<date>.remediation.md` (email body)

Human digest: a headline (`N fixed, M need you`), an "Applied" table, and an
"Escalated — needs review" section rendering each plan. Empty-day renders cleanly
("No drift; nothing to apply").

## Future consumers

- **Change manager (planned).** A more-supervised process that reads the
  `escalations` contract and implements the hard changes _inside change-management
  windows_, with human oversight and richer pre/post checks. This pipeline is
  explicitly the change manager's upstream: it never implements escalated items
  itself — it only produces the package. The `cm_window_hint` field is the first
  affordance for that handoff.

## Testing

vitest, mirroring the audit's suite (clients and the Anthropic API are mocked —
no live calls). TDD: tests first.

- **`executor.ts`** (most coverage): each of the four gates rejects
  independently; idempotency no-op → `skipped` with no client call; happy path →
  one call with exact args → `applied`; failure isolation (item 2 of 3 throws →
  others still processed); runaway guard (> `MAX_AUTO_APPLIES` → zero calls,
  whole batch escalated).
- **Reconcile:** live-authoritative split; an item in the morning report but not
  live is annotated `self_resolved` (not applied); a safe item live but not in the
  morning report is still applied; correct safe-vs-escalated partition.
- **`remediation-plan.ts`:** Sonnet mock → parsed `RemediationPlan`; Sonnet
  throws/times out → `raw` fallback; never throws.
- **`remediation-report.ts`:** JSON carries `schema_version` + documented
  `escalations` shape; markdown renders applied/skipped/failed counts + plans;
  empty-day renders cleanly.
- **`remediate-cli.ts`:** arg parsing; `--dry-run` writes nothing and calls no
  client; exit 0 when ≥1 instance audited, 1 when all hard-fail.
- **Shell smoke (manual, documented):** one `--dry-run` on the mini before
  enabling the live chain — the same "verified via launchctl" gate the audit used.

## Out of scope

- The change manager itself (consumes the `escalations` contract; separate piece).
- Persisting a queue / snooze / suppress history (proposal-queue spec Phase 2).
- Any provider beyond Coolify (the only `SAFE_TOOLS` entry today is
  `coolify_update_application`; the dispatch map is the extension point).
- Auto-applying anything beyond `safe` (permanent boundary by design).
