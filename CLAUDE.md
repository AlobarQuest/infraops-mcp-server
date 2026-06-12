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
    │   servers.ts, services.ts, control.ts,
│   diagnostics.ts, storages.ts, scheduled-tasks.ts  # Coolify (67 tools)
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

**195 tools total** across 7 providers.

See [RUNBOOK.md](./RUNBOOK.md) for provider configuration details (env vars, BWS secret IDs, `.claude.json` wiring, troubleshooting).

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

All Coolify tools accept an `instance` parameter (`"prod"` or `"dev"`, defaults to `"prod"`).

- **Prod**: `COOLIFY_PROD_BASE_URL` + `COOLIFY_PROD_API_TOKEN` (falls back to `COOLIFY_BASE_URL`/`COOLIFY_API_TOKEN`)
- **Dev**: `COOLIFY_DEV_BASE_URL` + `COOLIFY_DEV_API_TOKEN` (optional — local OrbStack VM at `http://192.168.139.217:8000`)

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

## Adding a New Provider

1. Create `src/services/<provider>-client.ts` with `isXxxConfigured()` export
2. Create `src/tools/<provider>-<feature>.ts` with `registerXxx(server)` export
3. Import and conditionally register in `src/index.ts`
4. Prefix all tool names with `<provider>_` to avoid collisions

## Known Non-obvious Invariants

**Service vs. Application env var endpoints are different**
Coolify has two distinct resource types with separate env var APIs:
- *Application* (single-container, Flavor A/B): `/applications/{uuid}/envs` — use `coolify_*_app_env` tools
- *Service* (docker-compose multi-container, Flavor C): `/services/{uuid}/envs` — use `coolify_*_service_env` tools

Calling `coolify_create_app_env` with a service UUID fails with a validation error. Always check which resource type a UUID belongs to before writing env vars.

**`coolify_update_service` requires base64-encoded `docker_compose_raw`**
The PATCH `/services/{uuid}` endpoint rejects raw YAML. Encode with `Buffer.from(yaml, "utf8").toString("base64")` before sending. The GET endpoints return raw YAML; only writes require base64.

**`coolify_list_deployments` uses a non-obvious endpoint path**
The deployment history endpoint is `/deployments/applications/{app_uuid}` (not `/applications/{uuid}/deployments`). Response is `{ count, deployments: [] }`, not a raw array.

## Secrets

All secrets come from BWS (Bitwarden Secrets Manager) via start.sh. Never hardcode tokens.
