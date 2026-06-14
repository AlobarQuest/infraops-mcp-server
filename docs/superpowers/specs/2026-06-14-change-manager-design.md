# Change Manager — Design

**Date:** 2026-06-14
**Status:** Approved (design)
**Origin:** The downstream consumer named in the remediation-pipeline spec
([`2026-06-13-remediation-pipeline-design.md`](./2026-06-13-remediation-pipeline-design.md)).
The remediation pipeline auto-applies only `safe`+`running:healthy` drift fixes and
escalates everything harder into a versioned `escalations[]` contract. The **change
manager** consumes those escalations: a human pre-approves them through a web GUI,
and a nightly windowed agent implements the approved ones against live infra.

## Overview

```
[03:00 audit+remediate] ── <date>.remediation.json (escalations[])  [mini]
        │ change-mgr sync (POST /api/sync, M2M)
        ▼
  ┌─ change-manager web app (Flavor B, Coolify) ─┐      ┌─ mini (infraops-mcp-server) ─┐
  │ FastAPI + HTMX + Postgres + Alobar ID SSO    │      │ sync:   POST /api/sync       │
  │ you review & approve in the GUI              │◄─API─┤ window: GET /api/items?      │
  │ owns the DB + the reconciliation rules       │ M2M  │         status=approved      │
  │ change-mgr.devonwatkins.com                  │      │ implements via curated       │
  └──────────────────────────────────────────────┘      │ infraops tools (Sonnet agent)│
                                                         │ 04:00 launchd window         │
                                                         └──────────────────────────────┘
```

Two sub-projects share one Postgres schema, with the web app's authenticated REST
API as the seam (the DB stays private to the web app; the mini never connects to
Postgres directly).

## Decisions (locked during brainstorming)

1. **Oversight: pre-approve, then autonomous window.** You review escalations and
   mark approve/defer/wontfix; a scheduled agent executes only the approved ones in
   a change window, unattended, and reports. Not interactive-per-change; not
   fully-autonomous.
2. **Review surface: a deployed web GUI + real database** — not a CLI/local-file
   queue. (See `[[feedback-operator-review-surfaces]]`.)
3. **Web app: Flavor B on Coolify** — FastAPI + Jinja/HTMX + Postgres + Alobar ID
   SSO at `change-mgr.devonwatkins.com`. Owns the DB schema + migrations.
4. **Executor: an in-repo (mini-side) Anthropic SDK tool-use agent with a curated,
   narrow allowlist of real infraops operations** — not headless Claude Code (too
   broad a tool surface) and not a hosted/Managed agent (can't reach the local
   stdio infraops MCP). The agent uses the Sonnet plan as *guidance* but acts only
   through vetted tools, because the plans' `infraops_tools` are unreliable (Sonnet
   invents tool names like `coolify_redeploy_application`, `coolify_create_s3_storage`
   that don't exist).
5. **Seam: the web app's authenticated REST API**, not direct Postgres — keeps the
   DB private, centralizes data rules, and the executor authenticates with an
   Alobar ID **M2M token**.
6. **Change window: a single nightly launchd slot (~04:00)** on the mini, right
   after the 03:00 audit/remediate so the queue is fresh.
7. **Executor must run on the mini** — infraops is a local stdio MCP; the DB is the
   seam between the cloud GUI and the mini-side executor.

## Why this is two sub-projects

- **Sub-project A — `change-manager` web app** (new repo, Flavor B): Postgres schema
  + Alembic migrations + FastAPI API + HTMX GUI + SSO + deploy. Owns the data.
- **Sub-project B — mini-side sync + window executor** (existing `infraops-mcp-server`
  repo): the contract fix, the `sync` push, and the 04:00 agent that implements
  approved items via infraops and reports outcomes.

The shared contract is the **DB schema** (exposed through the API). **Build order:**
(1) contract fix + DB schema, (2) web app, (3) mini-side sync + executor. Each
sub-project gets its own implementation plan.

## Data model (Postgres, owned by the web app)

### `change_items` — the queue (one row per stable identity)

```sql
change_items (
  id            bigserial PK,
  identity      text UNIQUE NOT NULL,   -- 'instance::ruleKey::uuid'  ← dedup key
  instance      text NOT NULL,          -- 'prod' | 'dev'
  rule_key      text NOT NULL,          -- 'coolify.enable_healthcheck', '571', '572'
  provider      text, resource_type text,
  resource_uuid text NOT NULL, resource_name text NOT NULL,
  risk          text NOT NULL,          -- safe | caution | destructive
  kind          text NOT NULL,          -- remediation | question
  reasoning     text NOT NULL,
  plan          jsonb NOT NULL,         -- Sonnet plan: root_cause, steps, infraops_tools, risk, rollback, cm_window_hint, generated_by
  note          text,                   -- verify-held reason, etc.
  status        text NOT NULL DEFAULT 'pending',
  decided_by    text, decided_at timestamptz,
  first_seen_at timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  source_report text,
  created_at, updated_at timestamptz
)
```

### `change_attempts` — heavy execution audit (one row per window attempt)

```sql
change_attempts (
  id PK, item_id FK→change_items, window_run_id FK→window_runs,
  started_at, finished_at timestamptz,
  outcome    text,   -- done | failed | blocked | skipped_conformant
  detail     text,
  tool_calls jsonb,  -- every curated-tool call + result the agent made
  rollback   jsonb   -- captured original values, for revert
)
```

### `change_events` — append-only history (one row per transition/action)

The complete timeline of every item from ingestion through `done`/`wontfix` and
across re-cycles. The GUI renders this as the item's history.

```sql
change_events (
  id PK, item_id FK→change_items NOT NULL, at timestamptz NOT NULL,
  actor       text NOT NULL,   -- 'sync' | 'user:devon@…' | 'executor'
  event_type  text NOT NULL,   -- ingested | approved | deferred | wontfixed | reactivated
                               -- | regression_reopened | claimed | attempt_done
                               -- | attempt_failed | attempt_blocked | resolved
  from_status text, to_status text,
  detail      text,
  attempt_id  FK→change_attempts, window_run_id FK→window_runs
)
```

### `window_runs` — one row per 04:00 run

```sql
window_runs (
  id PK, started_at, finished_at,
  considered int, applied int, failed int, blocked int, skipped int,
  status text,        -- running | done | error
  report_md text
)
```

### Status lifecycle

```
            ┌── sync: new ──► pending
 pending ◄──┤                   │ you (GUI): approve / defer / wontfix
   ▲        │                   ▼
   │ sync   │            approved ──► (window) in_progress ──► done
 (regression│              ▲                        │  ├─► failed   (post-verify failed)
  reopens   │   you: re-approve                     │  └─► blocked  (missing prereq / needs judgment)
  done/     │              └───────── failed/blocked ◄┘
  resolved) │   deferred ──(you)──► approved        in_progress ──► resolved (already conformant live)
            │   wontfix  ──(you: Reactivate)──► pending      (standing otherwise; survives sync)
            └── sync: identity gone from report ──► resolved
```

Every transition writes a `change_events` row (no silent status changes). Nothing
is hard-deleted: `done`/`wontfix`/`resolved` are display states; the row + its full
event trail persist forever, and a reappearing identity reopens the *same* row
(accumulating multi-cycle history) rather than creating a new one.

### Reconciliation (web-app-owned, on `POST /api/sync`)

The mini posts today's full escalation set; the app reconciles by `identity`:
- new identity → insert `pending` (+ `ingested` event)
- existing + drift persists → refresh `plan`/`note`/`last_seen_at`/`source_report`; keep status
- `done`/`resolved` reappears → reopen to `pending` (`regression_reopened`)
- `wontfix` → stays `wontfix` (standing decision; refresh last_seen)
- in queue but absent from today's report → `resolved` (`resolved` event) — except `wontfix`, which persists

### Idempotency guarantees

`identity` UNIQUE (no dup rows across days); executor pulls only `approved` and
flips to `in_progress` via `POST /claim` before acting (no double-apply on re-run);
each item re-validated live before any write (already-conformant → `resolved`).

## Sub-project A — the web app (Flavor B)

FastAPI (port 8000) + SQLAlchemy + Alembic + Jinja/HTMX + Postgres (Coolify DB
resource). GUI behind Alobar ID forward-auth; API behind an M2M bearer token.

### GUI pages (server-rendered + HTMX)
- `GET /` — Dashboard: the `pending` queue front and center, grouped by change-type
  (HTTPS / backups / health-check) with counts; filter tabs (pending / approved /
  blocked / done / wontfix / resolved / all).
- `GET /items/{id}` — Item detail: target, rule, reasoning, full Sonnet plan, note,
  and the event timeline + attempt history (expandable tool-call audit).
- Inline HTMX actions: `Approve` / `Defer` / `Won't-fix` / `Reactivate` — each
  transitions status, writes a `change_events` row (`actor = user:<sso-email>`),
  returns the updated row fragment.
- `GET /windows` — window-run history with counts + per-item outcomes.

### API (mini-facing, M2M)
- `POST /api/sync` — `{generated_at, source_report, escalations[]}` → reconcile → `{new, refreshed, resolved, reopened}`.
- `GET /api/items?status=approved&instance=…` — the window's work.
- `POST /api/items/{id}/claim` — atomic `approved→in_progress`; 409 if not approved.
- `POST /api/items/{id}/outcome` — `{outcome, detail, tool_calls, rollback}` → attempt row + status transition + event.
- `POST /api/items/{id}/reactivate` — `wontfix→pending` (also exposed in the GUI).
- `POST /api/window-runs` / `PATCH /api/window-runs/{id}` — run record + counts/report.
- `GET /api/health` — liveness (conforms to its own standard).

### Auth
- GUI: Alobar ID forward-auth; `decided_by` = authenticated email.
- API: Alobar ID **service-account M2M token** the mini holds (BWS, by-UUID),
  validated distinctly from the SSO cookie. Covered by the `sso-integration` pattern.

### Deploy
Standard Flavor B: GHCR image, GitHub Actions CI/CD, Coolify app + Postgres DB
resource, `change-mgr.devonwatkins.com` (FQDN field, HTTPS), health check
`/api/health`. New deployed app → follows the **app-brain → infra-brain → infraops**
workflow (onboarded after planning).

## Sub-project B — mini-side sync + window executor (`infraops-mcp-server`)

### Contract fix (prerequisite)
Add `instance` to the `Escalation` interface (`src/standards/remediation-report.ts`),
thread `t.instance` when building escalations (`src/standards/run-remediation.ts`),
bump the remediation report `schema_version → 2`. Update the remediation tests.

### `change-mgr sync`
Appended to the existing 03:00 job (audit → remediate → **sync**). Reads the day's
`<date>.remediation.json`, `POST /api/sync` with the M2M token. Thin client; the
web app does the reconciliation. **Best-effort:** a change-mgr API outage logs a
warning but does not fail the audit/remediate heartbeat (the escalations are still
on disk to sync on the next run).

### `change-mgr run-window` (04:00 launchd)
1. `GET /api/items?status=approved`.
2. Per item, up to `MAX_CHANGES_PER_WINDOW` (default 5):
   - `POST /claim` (skip on 409).
   - Re-validate live via infraops → already conformant? → `outcome: skipped_conformant` → resolved.
   - Run the agent (`runChangeAgent`).
   - `POST /outcome {outcome, detail, tool_calls, rollback}`.
   - Per-item isolation — one failure never aborts the batch.
3. `POST/PATCH /api/window-runs`; write `<date>.change-window.json/.md`; email; ping a new Healthchecks.io check.

### Curated tool surface (`src/change-manager/tools.ts`) — the blast-radius boundary
The ONLY writes the agent can make; hallucinated tool names cannot fire. Each =
JSON-schema def + handler wrapping `coolify-client` with validation, idempotency
re-check, rollback capture. The surface is deliberately scoped to the remediation
types that are both **API-automatable** (verified against Coolify 4.0.0-beta.473)
**and** genuinely a Coolify change — which, after investigation, is HTTPS and
health-checks. **DB backups are out of scope** (see below). Initial set:
- `get_application(uuid, instance)` — read current state.
- `set_application_domains(uuid, instance, domains)` — `PATCH /applications/{uuid}`
  fqdn http→https (captures original for rollback; uses `force_domain_override` to
  bypass conflict detection on a self-referential domain change).
- `redeploy_application(uuid, instance)` — `POST /applications/{uuid}/restart`
  (or `/deploy`) so the proxy/cert config regenerates.
- `set_application_healthcheck(uuid, instance, path, port)` — `PATCH /applications/{uuid}`
  health-check fields; the agent must supply a verified path, else `report_blocked`.
- `report_blocked(reason)` / `report_done(summary)` — end the loop with the outcome.

**Why no backup tool.** Coolify's API *does* expose a backup sub-resource
(`POST /databases/{uuid}/backups`), so backups are technically automatable — but
the right remediation for the flagged DBs is **not** a Coolify change at all: they
should be added to the existing **vps-backup** (Restic/NAS) pipeline like every
other database, and rule #572 should be re-pointed to verify *that* real coverage
(not Coolify's native `backup_configs`). Both are filed as **BACKLOG.md #3 (add the
DBs to vps-backup) and #4 (re-point rule #572)** and revisited after the change
manager ships. Until then, DB-backup escalations have no executor path and are
resolved by human decision in the GUI (`defer`/`wontfix`).

### Agent safety model
- Agent can call **only** the curated tools — `plan.infraops_tools` are guidance, never executed by name.
- Rollback captured before each write; executor **post-verifies** after (re-fetch →
  still drifted / unhealthy? → revert via captured rollback + mark `failed`).
- `MAX_CHANGES_PER_WINDOW` caps blast radius (excess stays `approved` for next window).
- Agent loop step cap (prevents runaway tool calls).
- Per-item isolation; API/model failure on one item → `failed`, continue.
- Change-mgr API unreachable → abort the run cleanly (nothing applied), ping HC `/fail`.
- Model `claude-sonnet-4-6` (Opus reserved for hard items, future).
- Every tool call + result recorded in `change_attempts.tool_calls`.

### Scheduling
`scripts/change-window.sh` (launchd ~04:00) fetches Coolify + Anthropic + the
change-mgr M2M token from BWS **by UUID** (`get_secret_by_id`), runs
`node dist/cli/change-mgr-cli.js run-window`, emails the digest, pings a new
Healthchecks.io check. New plist template + install script mirror the drift-audit
ones. *Operational prereq: create the Alobar ID service account + store its token in BWS.*

## Realistic expectations

Of the daily escalations, the executor only ever *acts* on the two
genuinely-Coolify, API-automatable change-types; the rest are first-class
human-decision or `blocked` outcomes, not failures:
- **HTTPS (rule #571):** the agent does these (set domains https → redeploy →
  post-verify cert), with rollback on failure. The real, common automatable case.
- **Health-check held (verify-gate):** apps like Watchtower/mirror may have no
  health endpoint at all; the right action is often a different path or an
  exemption — frequently `blocked` (needs a human path decision in the GUI).
- **DB backups (rule #572):** **not an executor concern.** The flagged DBs are
  genuinely unbacked and the fix lives in vps-backup, not Coolify (BACKLOG #3); the
  standard itself should be re-pointed at real coverage (BACKLOG #4). In the change
  manager these are resolved by `defer`/`wontfix` until those backlog items land.

Near-term value: structured approval + autonomous execution of the genuinely-doable
subset (HTTPS), with everything else cleanly surfaced for a human decision + why.

## Testing

- **Web app (pytest):** reconciliation state machine (new / refresh / resolve /
  regression-reopen / wontfix-survives); every transition writes an event; the
  reactivate path; the `claim` 409 guard; API auth (M2M vs SSO separation).
- **Mini executor (vitest, mocked):** curated tool handlers (validation / idempotency
  / rollback); the agent loop with an injected Anthropic client forcing tool-use
  sequences (asserts only vetted tools fire; blocked/done outcomes recorded);
  `run-window` orchestration (mocked API + agent: claim, conformant-skip, isolation,
  cap, post-verify-revert); the sync client. Plus updating remediation tests for
  `instance` + `schema_version: 2`.

## Future consumers / out of scope
- A richer tool surface (more remediation types) added to `tools.ts` over time.
- Opus for hard items; multi-window scheduling; provisioning tools for S3/secrets
  (deliberately excluded now — too high-blast-radius for autonomous setup).
- Notifications beyond the email digest.
