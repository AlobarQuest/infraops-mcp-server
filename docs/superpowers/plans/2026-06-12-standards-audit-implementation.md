# Standards Audit — Cross-Repo Implementation Plan

**Date:** 2026-06-12
**Status:** Ready to build
**Specs:** `docs/superpowers/specs/2026-06-12-discovery-proposal-queue-design.md` (proposal), `docs/superpowers/specs/2026-06-12-coolify-audit-standards-design.md` (tool)
**Repos touched:** `infra-brain` (`~/Projects/infra-brain`) and `infraops-mcp-server` (`~/Projects/infraops-mcp-server`)

## Goal

Ship `coolify_audit_standards` in infraops: a stateless, read-only tool that fetches machine-readable standards from infra-brain over a new REST API and emits executable remediation proposals for live Coolify resources. infra-brain owns _what_ the standards are; infraops owns _how_ to observe and remediate.

## Sequencing (important)

```
Phase 0 (infra-brain) ──deploy──▶ Phase 1 (infraops, built against mocks) ──▶ live verification
```

infra-brain ships first so `GET /api/rules` exists and is seeded. infraops can be **built and unit-tested in parallel against mocks**, but its **live verification** waits for infra-brain to deploy. Do not merge infraops to `main` until live verification passes (it would auto-deploy a tool pointing at an endpoint that may not exist yet).

---

## Phase 0 — infra-brain: structured standards + REST API

Work in `~/Projects/infra-brain`. Branch off `main` (CI deploys on push to `main`). Python 3.12, FastAPI-wrapping-FastMCP, Postgres, Alembic, pytest + testcontainers.

### 0.1 Add the `check` column to the `Rule` model

- In `src/db/models.py`, add to `class Rule`: `check: Mapped[dict | None] = mapped_column(JSONB, nullable=True)`. Import `JSONB` from `sqlalchemy.dialects.postgresql` (already used by `Combo.packages`).
- **Acceptance:** model imports cleanly; `check` is nullable (existing prose rules stay valid).

### 0.2 Alembic migration

- Generate: `alembic revision --autogenerate -m "add_check_to_rules"`.
- **Review the generated file** — it must be exactly `op.add_column('rules', sa.Column('check', postgresql.JSONB(), nullable=True))` and a matching `drop_column` downgrade. Nothing else.
- **Acceptance:** `alembic upgrade head` then `alembic downgrade -1` round-trips on a scratch DB.

### 0.3 Surface `check` through the repository + MCP tool

- `src/repositories/rules.py`: `list_all` already returns ORM rows — no query change needed. If there's a dict-mapping helper, include `check`.
- `src/tools/rules.py`: add `"check": r.check` to the `get_rules` result dicts; add an optional `check: dict | None = None` param to `add_rule` and pass it through to `repo.add`.
- **Acceptance:** `get_rules` returns `check` (null for prose rules); `add_rule` can persist a `check`.

### 0.4 New REST endpoint `GET /api/rules`

- Register a plain FastAPI route on the existing `app` object in `src/main.py` (do **not** exempt it from the auth middleware — it should require `x-brain-key`, same as MCP).
- Signature: `async def list_rules_api(category: str | None = None, severity: str | None = None)`. Open a session via the existing session factory, call `RuleRepository(session).list_all(category=category, severity=severity)`, return `{"rules": [ {id, severity, category, rule, reason, source_app, check, created_at(isoformat)} ]}`.
- **Acceptance:** `GET /api/rules?category=coolify` with a valid `x-brain-key` returns 200 + JSON incl. `check`; missing/invalid key returns 401; `/api/health` still works unauthenticated.

### 0.5 Author + seed the Coolify structured checks

- Add to `scripts/seed.py` (idempotent, `--skip-existing` already used on startup) the initial Coolify rules **with `check` payloads**. Seed at least:
  - **health check enabled** — `{resource:"coolify_application", assert:{field:"health_check_enabled",op:"eq",value:true}, when:{field:"status",op:"contains",value:"running"}, remediation_key:"coolify.enable_healthcheck", kind:"remediation"}`, severity `WARN`.
  - **HTTPS required** — `{resource:"coolify_application", assert:{field:"fqdn",op:"not_starts_with",value:"http://"}, when:{field:"fqdn",op:"non_empty"}, remediation_key:"coolify.force_https", kind:"remediation"}`, severity `WARN`.
  - **DB backup configured** — `{resource:"coolify_database", assert:{field:"backup_configs",op:"non_empty"}, when:{field:"status",op:"contains",value:"running"}, kind:"question"}`, severity `WARN` (no `remediation_key` yet — Coolify backup args unconfirmed).
- Each rule keeps a human `rule`/`reason` sentence too (prose + structure coexist).
- **Acceptance:** running the seed on a fresh DB inserts these with populated `check`; re-running is a no-op.

### 0.6 Tests (`tests/`)

- Repository: a rule round-trips with a `check` dict; prose rule has `check is None`.
- REST: using `app_client` + `auth_headers` fixtures — `GET /api/rules` returns seeded checks; 401 without key; category filter works.
- **Acceptance:** `pytest -x -v` green (CI runs the same with `MCP_ACCESS_KEY=a*64`).

### 0.7 Ship

- PR → merge to `main` → CI builds `ghcr.io/alobarquest/infra-brain` → Coolify redeploys → `alembic upgrade head` applies the column → seed runs → `/api/health` passes.
- **Acceptance (live):** `curl -H "x-brain-key: <key>" https://infra-brain.devonwatkins.com/api/rules?category=coolify` returns the seeded checks.

---

## Phase 1 — infraops: the audit tool

Work in `~/Projects/infraops-mcp-server`. Branch off `main` (CI deploys on push to `main` — keep this branch unmerged until live verification). TypeScript, MCP SDK (stdio), Vitest. Follow `docs/superpowers/specs/2026-06-12-coolify-audit-standards-design.md` exactly for file layout and types.

### 1.1 Secret + config wiring

- **(Manual — Devon)** Add a BWS secret `INFRABRAIN_ACCESS_KEY` whose value is infra-brain's `MCP_ACCESS_KEY` (64-char hex). Flag this; the agent cannot do it.
- `server/start.sh`: fetch `INFRABRAIN_ACCESS_KEY` from BWS following the existing per-secret pattern; export `INFRABRAIN_BASE_URL` (default `https://infra-brain.devonwatkins.com`).
- `.mcp.json`: add `INFRABRAIN_BASE_URL` to the `env` block.
- **Acceptance:** with both env vars set, `isInfrabrainConfigured()` returns true; absent, the tool degrades to cache/seed (it must not crash).

### 1.2 `src/services/infrabrain-client.ts`

- Axios singleton (mirror `hetzner-client.ts`): base URL `INFRABRAIN_BASE_URL`, header `x-brain-key: ${INFRABRAIN_ACCESS_KEY}`, 30s timeout. Export `infrabrainGet()`, `handleInfrabrainError()`, `isInfrabrainConfigured()`.
- **Acceptance:** unit test mocks axios and asserts the header + path.

### 1.3 `src/standards/` engine

- `check-engine.ts` — `StandardCheck`/`Proposal`/`Assertion` types + `evaluateCheck()` + the op set (`eq,neq,contains,not_contains,present,absent,empty,non_empty,starts_with,not_starts_with,matches`). Total functions; unknown op → skip + record, never throw.
- `remediation-registry.ts` — `REMEDIATIONS` map + `resolveRemediation()`. Only `coolify.enable_healthcheck` (safe) and `coolify.force_https` (caution) for Phase 1. Use only real `coolify_update_application` params.
- `seed-checks.ts` — embedded offline copy of the three seeded checks (same shape infra-brain returns).
- `standards-source.ts` — `loadCoolifyChecks()`: live → cache (`~/.infraops/standards-cache.json`) → seed; returns `{ checks, source }`.
- **Acceptance:** pure-unit tests for each op and for the live/cache/seed fallthrough.

### 1.4 `src/tools/audit.ts` + registration

- `registerAuditTools(server)` registering `coolify_audit_standards` per the spec handler (load checks → fan out `Promise.allSettled` over `/applications` + `/databases` → evaluate → emit proposals + `meta`/`summary`). `readOnlyHint: true`.
- `src/index.ts`: import + call `registerAuditTools(server);` right after `registerDiagnosticTools(server);`.
- **Acceptance:** `npm run build` (tsc) clean; tool appears in the registered set.

### 1.5 Tests (`tests/audit.test.ts`)

- Cover everything in the spec's Testing section: eval ops, `when` gating, remediation mapping + exact args, risk-from-registry, degrade path (`standards_source` live→cache→seed), `scope`/`categories` filters, `meta.not_audited`, partial-read resilience.
- **Acceptance:** `npm test` green.

### 1.6 Version + live verification

- Bump `package.json` 3.3.0 → 3.4.0.
- **Live (after Phase 0 deployed):** point a local infraops at the deployed infra-brain; run `coolify_audit_standards` against `prod`; confirm `meta.standards_source: "live"` and that proposals match reality (cross-check a couple against `coolify_list_applications`). Verify a known-good app produces no false proposal and a known-bad one (health check disabled) does.
- **Acceptance:** live run returns sensible proposals with `standards_source: "live"`; then merge to `main`.

---

## Verification checklist (staff-engineer bar)

- [ ] infra-brain migration round-trips up/down on a scratch DB.
- [ ] `GET /api/rules` requires auth; returns `check`; `/api/health` still anonymous.
- [ ] Seed is idempotent; live infra-brain serves the Coolify checks.
- [ ] infraops builds; all Vitest suites green; degrade path proven without infra-brain.
- [ ] Live audit reports `standards_source: "live"`; spot-checked proposals are real; no false positives on a conformant app.
- [ ] No proposal emits args a target tool can't accept (esp. health-check fields).
- [ ] Neither repo merged to `main` before its phase's acceptance passes; infraops merged only after live verification.

---

## Build-agent prompts (Sonnet)

Two prompts — run **Phase 0 to completion and deploy first**, then Phase 1. Each is self-contained; paste into a Sonnet build agent started in the relevant repo.

### Prompt A — infra-brain (Phase 0)

> You are working in the `infra-brain` repo (`~/Projects/infra-brain`), a Python 3.12 FastAPI-wrapping-FastMCP app, Postgres-backed, schema managed by Alembic, tested with pytest + testcontainers. CI deploys on push to `main`.
>
> **Task:** Add a structured, machine-readable `check` field to infrastructure rules and expose rules over a new authenticated REST endpoint, so another service (infraops) can fetch standards as data. Full design: read `~/Projects/infraops-mcp-server/docs/superpowers/specs/2026-06-12-discovery-proposal-queue-design.md` (the "standards contract" section) and the implementation plan `~/Projects/infraops-mcp-server/docs/superpowers/plans/2026-06-12-standards-audit-implementation.md` (Phase 0). Follow Phase 0 tasks 0.1–0.7 exactly.
>
> **Use TDD**: write the failing test first for each unit (repository `check` round-trip, `GET /api/rules` auth + payload + filter), then implement. Do not weaken or skip tests to make them pass.
>
> **Specifics that matter:**
>
> - `check` is `JSONB`, nullable (import from `sqlalchemy.dialects.postgresql`); existing prose rules must keep working with `check = NULL`.
> - The Alembic migration must be reviewed: a single `add_column` + matching `drop_column` downgrade, nothing auto-generated beyond that. Verify it round-trips (`upgrade head` then `downgrade -1`) on a scratch DB.
> - `GET /api/rules` is a plain FastAPI route on the existing `app` object in `src/main.py`. It must be protected by the existing `x-brain-key` auth middleware (do NOT exempt it like `/api/health`). Reuse `RuleRepository.list_all`. Return `{id, severity, category, rule, reason, source_app, check, created_at}`.
> - Seed the three Coolify checks in `scripts/seed.py` (health-check-enabled, HTTPS-required, db-backup) with the exact `check` JSON shapes in plan task 0.5. Seeding must stay idempotent.
>
> **Definition of done:** `pytest -x -v` green; migration round-trips; then open a PR to `main` with a clear description. Do NOT merge — stop and report so Devon can review and let CI deploy. After deploy, confirm `curl -H "x-brain-key: <key>" https://infra-brain.devonwatkins.com/api/rules?category=coolify` returns the seeded checks (ask Devon for the key; never hardcode or print it).
>
> Work in small, verifiable steps. If anything contradicts the spec or seems wrong, stop and surface it rather than guessing.

### Prompt B — infraops (Phase 1, after Phase 0 is deployed)

> You are working in the `infraops-mcp-server` repo (`~/Projects/infraops-mcp-server`), a TypeScript MCP server (stdio), tested with Vitest. CI deploys on push to `main` — **stay on a feature branch and do not merge** until told.
>
> **Task:** Add a stateless, read-only MCP tool `coolify_audit_standards` that fetches machine-readable standards from infra-brain's `GET /api/rules` REST API and emits executable remediation proposals for live Coolify resources. **Read the full spec first:** `docs/superpowers/specs/2026-06-12-coolify-audit-standards-design.md`, plus `docs/superpowers/plans/2026-06-12-standards-audit-implementation.md` (Phase 1). Follow the file layout, types, and tasks 1.1–1.6 exactly.
>
> **Use TDD**: for each unit (infra-brain client, each check operator, remediation mapping, the live→cache→seed fallback, the tool handler), write the failing Vitest first (mock `../src/services/infrabrain-client.js` and `../src/services/coolify-client.js` per `tests/services.test.ts`), then implement.
>
> **Specifics that matter:**
>
> - The tool is `readOnlyHint: true` — it NEVER calls a write tool. `planned_action` is data only.
> - Standards source order: live infra-brain → local cache (`~/.infraops/standards-cache.json`) → embedded `seed-checks.ts`. The output `meta.standards_source` must report which was used. The tool must NOT crash when infra-brain is unreachable or unconfigured — it degrades.
> - infra-brain auth is the `x-brain-key` header (NOT a Bearer token), value from env `INFRABRAIN_ACCESS_KEY`; base URL from `INFRABRAIN_BASE_URL`. Mirror `src/services/hetzner-client.ts` for the client shape.
> - A `check` carries a semantic `remediation_key`, never a tool name. The `remediation-registry.ts` maps key → `{tool, risk, buildArgs}`. Phase 1 keys: `coolify.enable_healthcheck` (risk safe) and `coolify.force_https` (risk caution). Use ONLY real `coolify_update_application` params (`health_check_enabled`, `health_check_path`, `health_check_start_period`, `domains` — confirmed in `src/tools/applications.ts:766-805`). Never emit args the tool can't accept. Checks with no resolvable remediation become `kind:"question"`.
> - Register the tool in `src/index.ts` right after `registerDiagnosticTools(server)`. Bump `package.json` to 3.4.0.
> - `server/start.sh` + `.mcp.json`: wire `INFRABRAIN_BASE_URL` and fetch `INFRABRAIN_ACCESS_KEY` from BWS following the existing secret pattern. (Devon adds the BWS secret separately — note it; do not invent a value.)
>
> **Definition of done:** `npm run build` clean (tsc) and `npm test` green, including a proven degrade path with infra-brain mocked as down. Then STOP and report — do not merge. Devon will run a live verification against the deployed infra-brain before merge.
>
> Work in small, verifiable steps. If reality contradicts the spec (e.g. a Coolify field name differs), stop and surface it rather than guessing.
