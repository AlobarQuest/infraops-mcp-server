# App Brain onboarding payload — `change-manager`

> Parked here because App Brain MCP was returning 502 during the 2026-06-14 Part-2
> deploy session. Once App Brain is healthy, call `App_Brain.onboard_app` with the
> fields below (one-to-one with the tool args). The app is **live and verified** —
> this is just the post-deploy knowledge capture (Task 7 final bullet).
>
> A companion infra-brain lesson already landed: **lesson 341** (Alobar ID
> forward-auth on Coolify — embedded outpost + three-router Traefik split).

## `onboard_app` arguments

- **slug:** `change-manager`
- **name:** `Change Manager`
- **status:** `live`
- **deployment_url:** `https://change-mgr.alobar.net`
- **repo_path:** `github.com/alobarquest/change-manager`
- **tags:** `["flavor-b", "coolify", "fastapi", "postgres", "alobar-id", "forward-auth", "infra-remediation"]`

### description
Web GUI plus Postgres for human pre-approval of infrastructure remediation
escalations. Consumes the escalations contract from the daily 03:00 remediation
pipeline (infraops-mcp-server); Devon reviews and approves/defers/wontfixes in the
GUI, and a nightly windowed executor (Plan 3, mini-side) implements approved items
via curated infraops tools. Sub-project A of the Change Manager design.

### tech_stack (JSON object)
```json
{
  "language": "Python 3.12",
  "framework": "FastAPI plus Jinja/HTMX",
  "db": "PostgreSQL 16 (Coolify-managed)",
  "orm": "SQLAlchemy plus Alembic",
  "auth_gui": "Alobar ID (Authentik) forward-auth via embedded outpost",
  "auth_api": "M2M shared bearer token (BWS)",
  "deploy": "Flavor B (GHCR image, GitHub Actions CI/CD, Coolify)",
  "port": 8000
}
```

### charter
The human-oversight layer of the infra auto-remediation system. The daily
remediation pipeline auto-applies only safe and healthy drift fixes and escalates
everything harder into a versioned escalations contract. The change manager
consumes those: a human pre-approves them through a web GUI, and a nightly windowed
agent (mini-side, Plan 3) implements approved ones against live infra via a curated
narrow allowlist of infraops operations. Oversight model: pre-approve then
autonomous window. Owns the Postgres schema; the mini never connects to Postgres
directly — the web app authenticated REST API is the seam.

### architecture_notes
Two sub-projects share one Postgres schema with the web app authenticated REST API
as the seam. Tables: change_items (queue, one row per stable identity
instance::ruleKey::uuid), change_attempts (per-window execution audit),
change_events (append-only timeline), window_runs (per 04:00 run). Lifecycle:
pending to approved/deferred/wontfix; approved to in_progress to
done/failed/blocked/resolved; reappearing identities reopen the same row
(regression_reopened); nothing hard-deleted. Reconciliation on the sync endpoint
keys by identity. GUI pages: dashboard (pending queue grouped by change-type), item
detail (plan plus event timeline plus attempt audit), inline HTMX
approve/defer/wontfix/reactivate, windows history. M2M API: sync, items by status,
claim, outcome, reactivate, window-runs, health.

### deployment_notes
Flavor B on Coolify prod. Project change-manager (gue4zdlul2gzwxo4he6b094p), app
uuid re45tafypao3nly3qa9a79dp, image ghcr.io/alobarquest/change-manager:main (the
host docker daemon is logged into ghcr.io so no per-app pull credential is needed).
Postgres 16-alpine resource uuid lhom8tm821v2xqr8vogcpktq (internal-only, coolify
network). Secrets in BWS Ops/Platform: change-manager/M2M_TOKEN and
change-manager/DATABASE_URL. Migrations run at container startup (alembic upgrade
head via entrypoint). Healthcheck on /api/health port 8000 — the image installs
curl so Coolify's in-container probe works. CI: GitHub Actions test, then GHCR
build/push, then Coolify deploy webhook (repo secrets COOLIFY_DEPLOY_WEBHOOK and
COOLIFY_DEPLOY_TOKEN). Domain change-mgr.alobar.net (Cloudflare proxied, SSL mode
Full). Alobar ID forward-auth via the embedded outpost on the Authentik server
container (server-alcvxqq7yiidffen7jpn5zj6:9000), wired in a Traefik file-provider
config at /data/coolify/proxy/dynamic/change-manager.yaml with a three-router split:
/outpost.goauthentik.io/* to the Authentik server; /api/* to the app (strip spoofed
X-authentik-* headers only, M2M bearer token guards it); GUI catch-all to the app
(strip plus forward-auth). High router priority shadows Coolify's auto-generated
catch-all router. App publishes no host port (forward-auth isolation). Header-spoof
negative test passes (fails closed). See infra-brain lesson 341.

## Notes for the onboarding agent
- Set `replace_existing: false` (first onboarding). If a partial record already
  exists from a retry, use `replace_existing: true`.
- This app is the consumer side of the remediation pipeline
  (`docs/superpowers/specs/2026-06-14-change-manager-design.md`). Sub-project B
  (mini-side sync + window executor) is Plan 3, not yet built.
