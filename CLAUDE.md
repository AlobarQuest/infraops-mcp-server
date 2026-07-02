# InfraOps MCP Server

Multi-provider MCP server for infrastructure operations (v3.3.0). TypeScript, Node.js 18+, stdio transport.

## Quick Reference

- **Build:** `npm run build` (tsc → dist/)
- **Dev:** `npm run dev` (tsx watch)
- **Entry:** `src/index.ts` → `dist/index.js`
- **Tests:** `npx vitest run` (test files in `tests/`)
- **Test watch:** `npm run test:watch` (vitest watch mode)
- **Clean:** `npm run clean` (removes `dist/`)
- **Run:** use `./start.sh` for full env var initialization (fetches secrets from BWS); use `node dist/index.js` only for standalone debugging where providers without env vars stay disabled.

## Architecture

```
src/
├── index.ts              # Server init, conditional provider registration
├── constants.ts          # CHARACTER_LIMIT (25K), DEFAULT_LIMIT, REQUEST_TIMEOUT
├── types.ts              # Coolify API response interfaces + CoolifyPrivateKey
├── schemas/common.ts     # Shared Zod schemas (UUID, pagination, response format, CoolifyInstance)
├── services/             # API clients (one per provider)
│   ├── coolify-client.ts # Multi-instance support (prod/dev)
│   ├── github-client.ts  # GitHub REST API (deploy keys, repos)
│   ├── hetzner-client.ts
│   ├── cloudflare-client.ts
│   ├── namecheap-client.ts
│   ├── supabase-client.ts
│   ├── ssh-client.ts     # SSH backend (prod — Hetzner)
│   ├── orb-client.ts     # OrbStack `orb run` backend (dev — local)
│   └── vps-dispatch.ts   # Routes vps_* ops to ssh/orb based on instance
└── tools/                # Tool registration modules (registerXxxTools functions)
    ├── projects.ts, applications.ts, private-keys.ts,
    │   deployments.ts, env-vars.ts, databases.ts,
    │   servers.ts, services.ts, control.ts, diagnostics.ts,
    │   storages.ts, scheduled-tasks.ts, database-backups.ts,
    │   github-apps.ts, docs.ts                            # Coolify (~86 tools)
    ├── github.ts                                         # GitHub (4 tools)
    ├── hetzner-servers.ts, hetzner-networking.ts          # Hetzner (26 tools)
    ├── vps.ts                                             # VPS SSH (7 tools)
    ├── namecheap-domains.ts, namecheap-dns.ts             # Namecheap (19 tools)
    ├── cloudflare-dns.ts, cloudflare-pages.ts,
    │   cloudflare-workers.ts, cloudflare-r2.ts,
    │   cloudflare-tunnels.ts, cloudflare-security.ts      # Cloudflare (44 tools)
    └── supabase-projects.ts, supabase-database.ts,
        supabase-functions.ts, supabase-config.ts          # Supabase (28 tools)
```

**~213 tools total** across 7 providers. (`src/utils/` holds the shared `response`/`summaries`/`masking` helpers used by the Coolify read tools.)

See [RUNBOOK.md](./RUNBOOK.md) for provider configuration details (env vars, BWS secret IDs, `.claude.json` wiring, troubleshooting).

## This repo runs from the local checkout — keep `main` current

There is **no remote deploy**: Claude Code launches this MCP as a subprocess from
*this working checkout* via `start.sh` → `node dist/index.js`. So a stale local
`main` (or a stale `dist/`) means **every build agent on this machine is using
out-of-date infra tooling**. The `SessionStart` hook
(`.claude/hooks/session-sync.sh`) fast-forwards `main` at session start *only when
safe* (on `main`, clean, behind origin); otherwise it just notifies. It never
switches branches, deletes, or blocks startup.

**The full chain to make a code change live: PR → merge → `git sync` → `/mcp
reconnect infraops`.** You do **not** need a local `npm run build`: `dist/` is
tracked and the CI `Build` workflow fails any PR whose committed `dist/` does not
match a fresh build (`git status --porcelain dist/`), so a merged `main` always
carries current compiled output — `git sync` brings it down via git alone. The one
remaining step is reloading the runtime: the MCP runs as a subprocess
(`start.sh` → `node dist/index.js`) launched at session start, so a session that
was already open is still executing the OLD `dist/`. Re-spawn it in place with
`/mcp reconnect infraops` (lighter than a full session restart); the session-sync
hook emits this reminder automatically when a fast-forward changed `dist/`.

## Provider agent — escalation when the MCP isn't enough

`bin/provider-agent` exposes this repo as a gated, stateful agent a consumer build
agent can call when it needs a capability the infraops MCP does **not yet expose**
(a missing tool, schema, or provider client). The provider agent may add/extend
tools and verify with `npm run build` + `npx vitest run`, but must **not** run them
against live infrastructure — see `provider-agent-brief.md` for the exact gate. Its
edits land on a `provider-agent/<session>` review branch for you to review/merge.

## Providers

| Provider | Prefix | Always On | Env Vars Required |
|----------|--------|-----------|-------------------|
| Coolify | `coolify_` | Yes | `COOLIFY_PROD_BASE_URL`, `COOLIFY_PROD_API_TOKEN` (or legacy `COOLIFY_BASE_URL`/`COOLIFY_API_TOKEN`) |
| VPS | `vps_` | Yes | None for prod (defaults to 178.156.247.239 via SSH). Dev uses `orb run` — no env vars needed beyond optional `VPS_DEV_ORB_MACHINE` (default `ubuntu`). |
| GitHub | `github_` | No | `GITHUB_TOKEN` |
| Hetzner | `hetzner_` | No | `HETZNER_API_TOKEN` |
| Namecheap | `namecheap_` | No | `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_PROXY_TOKEN` |
| Cloudflare | `cloudflare_` | No | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Supabase | `supabase_` | No | `SUPABASE_ACCESS_TOKEN` |

Optional providers only register their tools when their env vars are set.

### Coolify Multi-Instance

All Coolify tools accept an `instance` parameter (`"prod"` or `"dev"`). **Read tools default to `"prod"`; mutating tools require it explicitly** (see the invariant below — a bare write can no longer silently hit prod).

- **Prod**: `COOLIFY_PROD_BASE_URL` + `COOLIFY_PROD_API_TOKEN` (falls back to `COOLIFY_BASE_URL`/`COOLIFY_API_TOKEN`)
- **Dev**: `COOLIFY_DEV_BASE_URL` + `COOLIFY_DEV_API_TOKEN` (optional — local OrbStack VM at `http://192.168.139.217:8000`, a.k.a. `coolify-dev.local`)

#### Coolify: which tool when (three overlapping paths, intentional)

There are **three** MCP paths to Coolify, by design (redundancy/resilience — if one breaks, the other works):

| Path | Instance selection | Use for |
|------|--------------------|---------|
| `infraops` `coolify_*` | `instance` **parameter** | Anything needing infraops' extras: cross-provider work, BWS-sourced secrets, the security-drift subsystem, compose helpers (`set_compose_config`, `reset_labels`), `audit_standards`. |
| `coolify-1` MCP | **server identity = prod** | Pure prod Coolify work where you want the instance baked in (can't misroute). Tracks upstream `@masonator/coolify-mcp`; has `search_docs`. |
| `coolify-dev` MCP | **server identity = dev** | Pure dev/OrbStack Coolify work; physically cannot touch prod. |

Key safety difference: in `infraops` the target is a *parameter* (so mutations now require it explicitly), whereas the standalone `coolify-1`/`coolify-dev` encode the instance in the *server identity* (impossible to misroute). For a dev app like FacelessTT, `infraops coolify_deploy({uuid, instance: "dev"})` and `coolify-dev deploy` reach the **same** OrbStack instance.

#### Ported capabilities (parity with the standalone MCP)

These were ported from `@masonator/coolify-mcp` so agents can stay on the single audited `infraops` path:
- **Database backups** (`coolify_{list,get}_database_backups`, `coolify_{list,get}_backup_executions`, `coolify_{create,update,delete}_database_backup`, `coolify_delete_backup_execution`) — `/databases/{uuid}/backups`.
- **Deployment cancel** (`coolify_cancel_deployment`) — `POST /deployments/{uuid}/cancel`.
- **Cross-app bulk env** (`coolify_bulk_set_app_env`) — sets ONE key/value across many app UUIDs (vs `coolify_bulk_create_app_envs` = many keys, one app); returns a per-app succeeded/failed summary.
- **GitHub-App management** (`coolify_{list,get,create,update,delete}_github_app`, `coolify_list_github_app_repos`, `coolify_list_github_app_branches`) — Coolify's `/github-apps` resource, distinct from the `github_*` deploy-key provider.
- **`coolify_search_docs`** — BM25 search over the official Coolify docs (lazy-cached fetch of `llms-full.txt`). **Instance-agnostic — takes no `instance` parameter.**

#### Read-tool response conventions (token hygiene)

- **`summary` (default `true`)** on `coolify_list_{applications,databases,services,servers,projects}` and `coolify_overview` returns a compact projection (essential fields only). Pass `summary: false` for full objects. This replaces the old behavior where lists were stringified in full and could flood context (`list_applications` once returned 185K chars). Projections live in `src/utils/summaries.ts`.
- **`reveal` (default `false`)** on `coolify_list_applications` / `coolify_get_application` / `coolify_get_service`: webhook HMAC secrets (`manual_webhook_secret_*`) and `http_basic_auth_password` are masked unless `reveal: true` (`src/utils/masking.ts`). `null` is preserved (= "no secret set"). Env-var `value`/`real_value` masking is unchanged (env-vars.ts).
- **`jsonResponse` (`src/utils/response.ts`)** is serialize-only; truncation (25K via `truncateToLimit`) and secret redaction are applied centrally by the `installRedaction` wrapper (`src/utils/register-sanitized.ts`) after serialization, so a secret is never split across a truncation boundary.

### VPS Multi-Instance

All `vps_*` tools (`vps_exec`, `vps_health`, `vps_read_file`, `vps_write_file`, `vps_docker_ps`, `vps_docker_logs`, `vps_docker_stats`) accept the same `instance` parameter and MUST be kept in sync with the Coolify instance when debugging Coolify-managed containers. Omitting `instance` defaults to `"prod"` so existing callers keep working.

- **Prod** (`instance: "prod"`): SSH into Hetzner at `VPS_HOST` (default `178.156.247.239`) as `VPS_USER` (default `root`), key from `VPS_SSH_KEY_PATH` (default `~/.ssh/hetzner_ed25519`). Unchanged from pre-v3.3.0 behavior.
- **Dev** (`instance: "dev"`): `orb run -m $VPS_DEV_ORB_MACHINE bash -c <cmd>` against an OrbStack Linux machine. The optional `VPS_DEV_ORB_MACHINE` env var selects the OrbStack machine name and defaults to `"ubuntu"` (see `src/services/orb-client.ts`); the machine is routable at `192.168.139.217`. Runs as `devon`, so the docker-specific tools automatically prefix `sudo docker` — callers of `vps_exec` must add `sudo` themselves for raw docker commands.

**Why this exists:** prior to v3.3.0 the `vps_*` tools silently ignored any instance intent and always hit Hetzner prod, so pairing `coolify_list_applications({instance: "dev"})` with `vps_exec(...)` misrouted and returned phantom "container not found" results. See the routing dispatcher in `src/services/vps-dispatch.ts`.

### Private Repo Deployment Workflow

Full end-to-end workflow for deploying a private repo:

1. `coolify_create_private_key` → generates Ed25519 key pair, stores in Coolify, returns public key
2. `github_add_deploy_key` → adds public key to GitHub repo (read-only)
3. `coolify_create_application_deploykey` → creates app linked to the private key
4. `coolify_set_compose_config` → (for compose apps) sets domains, compose location, clears labels
5. `coolify_deploy` → triggers deployment

### Compose App Configuration

For `dockercompose` build pack apps:
- **Do NOT use `domains`** on the application — use `docker_compose_domains` instead
- `coolify_set_compose_config` sets `docker_compose_domains`, `docker_compose_location`, and clears `custom_labels` in one call
- `coolify_reset_labels` clears stale Traefik labels after domain changes

## Patterns

- Tools use `server.registerTool()` with Zod input schemas
- Each tool file exports a `registerXxxTools(server: McpServer)` function
- Clients handle HTTP requests + error formatting; tools handle schema + response shaping
- Response character limit of 25K to avoid flooding LLM context
- Namecheap uses a proxy service (`namecheap-proxy`) for IP whitelisting — not direct API
- Coolify client functions accept an optional `instance` parameter as the last argument
- SSH key generation uses `ssh2.utils.generateKeyPairSync('ed25519')` — zero additional deps
- **Central secret redaction:** `installRedaction(server)` (`src/utils/register-sanitized.ts`) patches `registerTool` once so EVERY tool response is redacted by default (`src/utils/redaction.ts`: secret field-names + value-shapes — PEM keys, JWTs, token prefixes, connection-string passwords). Redaction precedes truncation (`jsonResponse` is serialize-only; the wrapper truncates). Opt out per-call with `reveal: true` (audited via high-power-audit-log); pure value-read tools (`vps_read_file`, `vps_exec`, `vps_docker_logs`, `cloudflare_get_kv_value`, `cloudflare_query_d1`, `namecheap_domains_get_contacts`) are in `ALWAYS_BYPASS`. Kill switch: `INFRAOPS_DISABLE_REDACTION=1`. Existing `masking.ts`/`env-vars.ts`/`private-keys.ts` masks stay as defense-in-depth.

## Adding a New Provider

1. Create `src/services/<provider>-client.ts` with `isXxxConfigured()` export
2. Create `src/tools/<provider>-<feature>.ts` with `registerXxx(server)` export
3. Import and conditionally register in `src/index.ts`
4. Prefix all tool names with `<provider>_` to avoid collisions

## Known Non-obvious Invariants

**Mutating `coolify_*` tools require an explicit `instance`; reads default to `prod`**
The `instance` selector is split across two shared schemas in `src/schemas/common.ts`: read tools use `CoolifyInstanceSchema` (`.default("prod")`), while every mutating tool uses `CoolifyInstanceRequiredSchema` (no default). Classification follows each tool's `readOnlyHint` annotation — `readOnlyHint: false` ⇒ required. A bare mutating call (e.g. `coolify_deploy({uuid})` with no `instance`) is now **rejected at the Zod tool boundary**, by design: it used to silently default to prod (Hetzner) and could deploy a dev app to the wrong place. Reads keep the convenience default because a misrouted read is harmless. When adding a new mutating tool, wire its `instance` field to `CoolifyInstanceRequiredSchema`, not `CoolifyInstanceSchema` (guarded by `tests/instance-schema.test.ts`). Note: this only affects the MCP tool boundary — internal callers (e.g. `src/security-drift/*`) invoke the `coolifyGet/Post/...` client helpers directly with an explicit instance arg and are unaffected.

**Service vs. Application env var endpoints are different**
Coolify has two distinct resource types with separate env var APIs:
- *Application* (single-container, Flavor A/B): `/applications/{uuid}/envs` — use `coolify_*_app_env` tools
- *Service* (docker-compose multi-container, Flavor C): `/services/{uuid}/envs` — use `coolify_*_service_env` tools

Calling `coolify_create_app_env` with a service UUID fails with a validation error. Always check which resource type a UUID belongs to before writing env vars.

**`coolify_update_service` requires base64-encoded `docker_compose_raw`**
The PATCH `/services/{uuid}` endpoint rejects raw YAML. Encode with `Buffer.from(yaml, "utf8").toString("base64")` before sending. The GET endpoints return raw YAML; only writes require base64.

**`coolify_list_deployments` uses a non-obvious endpoint path**
The deployment history endpoint is `/deployments/applications/{app_uuid}` (not `/applications/{uuid}/deployments`). Response is `{ count, deployments: [] }`, not a raw array.

**`dist/` is tracked in git — every `src/` change must rebuild AND commit `dist/`, or the runtime stays stale**
This repo commits its compiled output: `dist/` is NOT gitignored, because the MCP server (`dist/index.js`) and the headless drift/change-manager CLIs (`dist/cli/*.js`) run from it, not from `src/`. Vitest transpiles `src/` directly, so **a green test suite does NOT prove `dist/` is current** — you can change `src/`, pass all tests, commit, and ship a stale `dist/` whose runtime behavior lacks your change. Always `npm run build` and `git add dist/` in the same commit as the `src/` change (or a follow-up build commit). Symptom that bit us once: control-plane taxonomy routing worked in tests but the committed `dist/security-drift/taxonomy.js` still had the old classifier. When reviewing a PR that edits `src/`, confirm the matching `dist/` files are in the diff.

## Security-Drift Subsystem (`src/security-drift/`)

Feeds the security detector into the daily 3am drift job + the change-manager
approval pipeline. The detector itself is **repo-managed in `~/Projects/security-standards`** (detect lane) (`security-standards/scripts/security-scan.sh`,
plus the skills/hooks linter `security-standards/scripts/skills-security-scan.sh`) and deployed to
`~/.claude/bin/` by `security-standards/scripts/install-security-scan-launchd.sh` — which also installs the
standalone weekly `com.devon.security-scan` LaunchAgent (Mon 09:00, logs-only). The runtime
resolves the scanner at `~/.claude/bin/security-scan.sh` (`paths.ts`, env-overridable via
`SECURITY_SCAN_PATH`). CLI entry: `dist/cli/security-drift-cli.js run` (chained into
`scripts/drift-audit.sh`). Modules: `scan-parser` → `taxonomy` (classify, deny-by-default)
→ `baseline` (0600-validated accepted baseline + diff) → `autofix` (guarded chmod) →
`emit`/`emit-state` (CM escalations + plan-hash) → `notify` (Resend urgent) → `runner`
(orchestrator). `security-scan.sh` includes Check 13: control-plane git drift (`~/.claude`
tracked-file tamper-evidence) — critical-set changes escalate URGENT; `settings.local.json`
churn is dropped by `taxonomy.ts`. The 4am verbatim executor is `security-executor.ts`, invoked via
`change-mgr-cli.js run-security-window` (chained into `scripts/change-window.sh`). Shared
file locations live in `paths.ts`. See `~/docs/security-audit/security-drift-taxonomy.md`
for the authoritative tier rules.

### Credential-rotation lane (WS-0.7)

The same detect→approve→execute loop rotates credentials as a change-class
(spec: `~/docs/software-delivery-system/2026-07-02-ws07-credential-rotation-spec.md`):

- **Registry:** per-repo `.cred-consumers.toml` (this repo's covers the machine/ops-scope
  creds) maps each managed credential → its consumers (BWS secret, Keychain item, Coolify
  env, GH Actions secret). Files are listed in `~/.config/infra-drift/cred-consumers.list`
  (deny-by-default: unlisted ⇒ unmanaged). Parsed by `cred-consumers.ts` (strict-subset
  TOML parser, deliberately dependency-free in the 4am write path).
- **Detect:** `cred-rotation.ts` emits `cred.exposure-rotate` (FAIL, one-shot until the
  exposure is recorded resolved in the 0600 `cred-rotation-state.json`) and
  `cred.rotation-age` (WARN past per-class max age; infra-brain rules #1031/#1032). Merged
  into the 3am run via `extraFindings`; classifications are pre-built per credential and
  routed through `taxonomy.ts`'s `cred.*` branch (no plan ⇒ URGENT manual, never guessed).
- **Execute:** approved `{ rotation: RotationPlanSpec }` remediations run in
  `rotation-executor.ts` (same plan-hash gate): store (quarantine old value under a
  distinct BWS name, edit the keeper secret IN PLACE so by-UUID fetchers keep working) →
  deploy (consumer updates, value moved by pipe/UUID, never argv where avoidable) →
  verify (provider auth 200; gh keeper probe for GitHub classes) → revoke-confirm (probe
  old value; retire the BWS copy ONLY on a strict 401 — 403/5xx is indeterminate and
  refuses). Multi-night by design: "old still live" posts `blocked` until Devon's console
  revoke, then a re-approve completes it.
- **Devon-only steps:** CREATE (mint at the provider console) and provider REVOKE. Staged
  handoff = Keychain item `cred-rotation/<cred-id>` filled in a real Terminal. Orphan
  creds with no probe-able old value are closed via
  `security-drift-cli.js resolve-exposure --cred <id> --exposure <id>`.
- **Never in the lane:** Coolify PG passwords (volume-recreate only), BWS machine tokens
  (console-only), brain MCP keys (claude.ai connector re-key — manual, paired reconfig).
- **Consumer mapping:** `scripts/cred-consumer-sweep.py` — fingerprint (sha256) hash-compare
  across Keychain/shell/config/BWS/Coolify surfaces; prints locations + hash prefixes only,
  never values. Its attestation date goes in `consumers_verified`.

### Known Non-obvious Invariants (security-drift)

**Security findings POST to the SAME `/api/sync` but with `source:"security"`; reconcile is source-scoped.**
`change-manager/app/reconcile.py` resolves any open item NOT present in the current sync.
Without source-scoping, a security sync would mark every Coolify *drift* item resolved (and
vice-versa). The runner therefore POSTs the FULL current non-auto finding set every run (not
the diff) so reconcile resolves cleared items correctly; the baseline/diff gates only the
immediate URGENT email.

**The 4am security executor runs approved `exec:` plans VERBATIM (no LLM) and is gated by a plan-hash.**
`security-executor.ts` recomputes `sha256(canonicalJSON(plan))` and compares it to the hash
recorded in the 0600 `security-emit-state.json` at emit time (keyed by the finding fingerprint
= `resource_uuid`). Mismatch / missing / tampered emit-state → refuse + alert, never execute.
`manual:` remediations are tracked-only. The Coolify `run-window` excludes `source==="security"`
so the Sonnet agent never receives a security item.

**Rotation never revokes: the executor's "revoke" step only CONFIRMS death (strict 401) then retires the BWS copy.**
Create and provider-revoke are ALWAYS Devon console actions (decision 2026-07-02). The executor
refuses to touch any credential whose `.cred-consumers.toml` entry lacks a `consumers_verified`
attestation (fail-safe #1), any class outside `CLASS_POLICY`'s `executor: true` set, and any
old-value probe that isn't exactly 401. Verify-before-revoke is structural (sequential code with
early returns), not plan-authored — a plan cannot express revoke-first.

**Auto-fix is Node `O_NOFOLLOW` + `fchmod`-on-fd, not bash `chmod`.** The taxonomy's TOCTOU /
symlink / hardlink / owner guards require operating on the open fd (the inode), which bash's
path-based `chmod` cannot do safely. The path-allowlist is deny-by-default (empty ⇒ nothing
auto-fixes); a blocked guard re-tiers the finding to URGENT.

**The detector lives in `security-standards` but RUNS from `~/.claude/bin/`; editing it requires re-running the installer.**
`security-standards/scripts/security-scan.sh` is the source of truth, but both the embedded 3am CLI and the
standalone LaunchAgent execute the *deployed* `~/.claude/bin/security-scan.sh`. Editing the
repo copy has NO effect until `security-standards/scripts/install-security-scan-launchd.sh` redeploys it. The
self-check's runner-integrity gate (`self-check.ts`, step 3) sha256s the deployed scanner, so
a redeploy surfaces exactly one `selfcheck.runner_integrity` URGENT ("scanner hash changed —
verify intentional") on the next run, then records the new hash. This same gate is what catches
any *out-of-band* edit to the deployed copy. Keep the two in sync via the installer, never by
hand-editing `~/.claude/bin/`.

## Secrets

All secrets come from BWS (Bitwarden Secrets Manager) via start.sh. Never hardcode tokens.

<!-- code-standards:start -->
# Code Quality (code-standards layer)

Standards reference: `~/Developer/code-standards/STANDARDS.md`

## Before writing a cross-cutting pattern — query Code Brain

Before implementing a recurring cross-cutting concern (logging, error handling,
auth, notifications, API conventions, secrets, …), query **Code Brain** — the
machine source of record for our paved roads — and follow its rules:

- `get_road("<slug>")` → the decided approach + rules + exemplars, or
- `get_rules(severity="BLOCK")` → the must-follow rules.

Do **not** infer the standard from existing code; it may predate the standard.
When you decide a new cross-cutting pattern, write it back (`add_road` / `add_rule`).

## Before declaring a non-trivial change done

1. Run `make check` — full-repo lint, type-check, and tests must be green.
2. Run `/code-review` — review the diff for correctness bugs and simplification opportunities.

Both gates apply to any change that touches logic, interfaces, or configuration.
Trivial fixes (typos, comment edits) may skip `/code-review` at your discretion.

## Enforcement

A diff-scoped Stop hook enforces this automatically: it runs the linters over your
changed files when the session ends and blocks completion if new violations are
introduced. Existing baseline violations are tracked and do not block.

## Canonical example module

The authoritative pattern for this repo's style is:

the cleanest, most idiomatic existing module in this repo

When writing new code, mirror the structure, naming conventions, and documentation
style of that module.

<!-- code-standards:end -->
