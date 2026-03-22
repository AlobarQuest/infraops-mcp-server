# Cloudflare & Supabase Integration — Design Spec

**Date:** 2026-03-22
**Status:** Draft
**Version:** infraops-mcp-server 3.0.0

## Overview

Add Cloudflare and Supabase as direct providers in infraops-mcp-server, following the existing Hetzner/Coolify/Namecheap pattern. This makes infraops the single "smart hands" for all infrastructure management.

Both providers use bearer token auth fetched from BWS at startup. No new npm dependencies are required — both use the existing `axios` client against their REST APIs.

## Decisions

- **Direct integration over proxy.** We build thin REST clients rather than proxying official MCP servers. This gives us consistent tool naming, shared error handling, cross-provider workflow potential, and centralized BWS auth. The REST APIs are stable and change less frequently than MCP server implementations.
- **Axios over official SDKs.** Keeps the codebase consistent with existing providers. The Cloudflare and Supabase REST APIs are clean enough that typed axios calls are sufficient.
- **Management API only for Supabase.** The PAT-authenticated Management API covers projects, SQL execution, Edge Functions, secrets, auth config, and storage buckets. Data-plane operations (user admin, storage objects) would require per-project `service_role` keys and are out of scope.
- **Single broad-scoped Cloudflare token.** One API token with permissions across DNS, Pages, Workers, R2, Tunnels, WAF, and SSL. Stored in BWS.
- **Version bump to 3.0.0.** Two new providers is a major addition.

## Auth & Client Services

### Cloudflare — `src/services/cloudflare-client.ts`

- **Base URL:** `https://api.cloudflare.com/client/v4`
- **Auth:** `Authorization: Bearer ${CLOUDFLARE_API_TOKEN}`
- **Env vars:**
  - `CLOUDFLARE_API_TOKEN` (required) — scoped API token from BWS
  - `CLOUDFLARE_ACCOUNT_ID` (required) — account ID for account-scoped resources (Workers, Pages, R2, Tunnels)
- **Pattern:** Singleton axios instance, identical to `hetzner-client.ts`
- **Exports:**
  - `cloudflareGet(endpoint, params?)` — GET with query params
  - `cloudflarePost(endpoint, data?)` — POST
  - `cloudflarePut(endpoint, data?)` — PUT
  - `cloudflarePatch(endpoint, data?)` — PATCH
  - `cloudflareDelete(endpoint)` — DELETE
  - `handleCloudflareError(error)` — maps Cloudflare's `{ success: false, errors: [{ code, message }] }` format to actionable strings
  - `isCloudflareConfigured()` — checks `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
- **Error mapping:**
  - 401 → invalid/expired token, regenerate in Cloudflare dashboard
  - 403 → token lacks required permission scope
  - 404 → resource not found
  - 429 → rate limit exceeded (1,200 req / 5 min)
  - 5xx → Cloudflare service issue

### Supabase — `src/services/supabase-client.ts`

- **Base URL:** `https://api.supabase.com/v1`
- **Auth:** `Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}`
- **Env vars:**
  - `SUPABASE_ACCESS_TOKEN` (required) — Personal Access Token from BWS
- **Pattern:** Singleton axios instance, identical to `hetzner-client.ts`
- **Exports:**
  - `supabaseGet(endpoint, params?)` — GET with query params
  - `supabasePost(endpoint, data?)` — POST
  - `supabasePatch(endpoint, data?)` — PATCH
  - `supabaseDelete(endpoint, data?)` — DELETE (some Supabase endpoints accept a body on DELETE)
  - `handleSupabaseError(error)` — maps HTTP errors to actionable strings
  - `isSupabaseConfigured()` — checks `SUPABASE_ACCESS_TOKEN`
- **Error mapping:**
  - 401 → invalid/expired PAT, regenerate at dashboard.supabase.com/account/tokens
  - 403 → insufficient permissions
  - 404 → project or resource not found
  - 422 → validation error
  - 429 → rate limit (~60 req/min)
  - 5xx → Supabase service issue

## Cloudflare Tool Files

### `src/tools/cloudflare-dns.ts` — Zone & DNS Record Management

| Tool | Description | Annotations |
|------|-------------|-------------|
| `cloudflare_list_zones` | List all zones (domains) on the account | readOnly |
| `cloudflare_get_zone` | Get zone details by ID | readOnly |
| `cloudflare_list_dns_records` | List records for a zone (filterable by type, name) | readOnly |
| `cloudflare_create_dns_record` | Create A/AAAA/CNAME/MX/TXT/SRV/etc record | — |
| `cloudflare_update_dns_record` | Update an existing record | — |
| `cloudflare_delete_dns_record` | Delete a record | destructive |

### `src/tools/cloudflare-pages.ts` — Pages Projects & Deployments

| Tool | Description | Annotations |
|------|-------------|-------------|
| `cloudflare_list_pages_projects` | List all Pages projects | readOnly |
| `cloudflare_get_pages_project` | Get project details (domains, build config, env vars) | readOnly |
| `cloudflare_create_pages_project` | Create a new project | — |
| `cloudflare_delete_pages_project` | Delete a project | destructive |
| `cloudflare_list_pages_deployments` | List deployments for a project | readOnly |
| `cloudflare_get_pages_deployment` | Get deployment details/status | readOnly |

### `src/tools/cloudflare-workers.ts` — Worker Scripts, KV & D1

| Tool | Description | Annotations |
|------|-------------|-------------|
| `cloudflare_list_workers` | List worker scripts | readOnly |
| `cloudflare_get_worker` | Get worker details (routes, bindings) | readOnly |
| `cloudflare_delete_worker` | Delete a worker script | destructive |
| `cloudflare_list_kv_namespaces` | List KV namespaces | readOnly |
| `cloudflare_list_kv_keys` | List keys in a namespace | readOnly |
| `cloudflare_get_kv_value` | Read a KV value | readOnly |
| `cloudflare_put_kv_value` | Write a KV value | — |
| `cloudflare_delete_kv_value` | Delete a KV key | destructive |
| `cloudflare_list_d1_databases` | List D1 databases | readOnly |
| `cloudflare_query_d1` | Execute SQL against a D1 database | — |

### `src/tools/cloudflare-r2.ts` — R2 Storage Buckets

| Tool | Description | Annotations |
|------|-------------|-------------|
| `cloudflare_list_r2_buckets` | List R2 buckets | readOnly |
| `cloudflare_create_r2_bucket` | Create a bucket | — |
| `cloudflare_get_r2_bucket` | Get bucket details | readOnly |
| `cloudflare_delete_r2_bucket` | Delete a bucket | destructive |

### `src/tools/cloudflare-tunnels.ts` — Cloudflare Tunnel Management

| Tool | Description | Annotations |
|------|-------------|-------------|
| `cloudflare_list_tunnels` | List tunnels | readOnly |
| `cloudflare_get_tunnel` | Get tunnel details and connections | readOnly |
| `cloudflare_create_tunnel` | Create a new tunnel | — |
| `cloudflare_delete_tunnel` | Delete a tunnel | destructive |
| `cloudflare_get_tunnel_config` | Get tunnel ingress configuration | readOnly |
| `cloudflare_update_tunnel_config` | Update tunnel ingress rules | — |

### `src/tools/cloudflare-security.ts` — WAF, Firewall & SSL/TLS

| Tool | Description | Annotations |
|------|-------------|-------------|
| `cloudflare_get_ssl_setting` | Get zone SSL mode (off/flexible/full/strict) | readOnly |
| `cloudflare_update_ssl_setting` | Change SSL mode | — |
| `cloudflare_list_firewall_rules` | List zone firewall rules | readOnly |
| `cloudflare_create_firewall_rule` | Create a firewall rule | — |
| `cloudflare_update_firewall_rule` | Update a firewall rule | — |
| `cloudflare_delete_firewall_rule` | Delete a firewall rule | destructive |
| `cloudflare_list_rulesets` | List WAF rulesets for a zone | readOnly |

**Cloudflare total: 37 tools across 6 files.**

## Supabase Tool Files

### `src/tools/supabase-projects.ts` — Project Lifecycle

| Tool | Description | Annotations |
|------|-------------|-------------|
| `supabase_list_projects` | List all projects | readOnly |
| `supabase_get_project` | Get project details (status, region, database info) | readOnly |
| `supabase_create_project` | Create a new project (name, org, region, db password, plan) | — |
| `supabase_delete_project` | Delete a project | destructive |
| `supabase_pause_project` | Pause a project | — |
| `supabase_restore_project` | Resume a paused project | — |
| `supabase_list_organizations` | List organizations (needed for project creation) | readOnly |
| `supabase_get_api_keys` | Get a project's API keys (anon, service_role) | readOnly |

### `src/tools/supabase-database.ts` — SQL & Postgres Config

| Tool | Description | Annotations |
|------|-------------|-------------|
| `supabase_run_sql` | Execute arbitrary SQL against a project's database | — |
| `supabase_list_extensions` | List available/enabled Postgres extensions | readOnly |
| `supabase_get_postgres_config` | Get Postgres configuration | readOnly |
| `supabase_update_postgres_config` | Update Postgres settings | — |

### `src/tools/supabase-functions.ts` — Edge Functions

| Tool | Description | Annotations |
|------|-------------|-------------|
| `supabase_list_functions` | List Edge Functions for a project | readOnly |
| `supabase_get_function` | Get function details (status, version, route) | readOnly |
| `supabase_create_function` | Create/deploy an Edge Function | — |
| `supabase_update_function` | Update an Edge Function | — |
| `supabase_delete_function` | Delete an Edge Function | destructive |

### `src/tools/supabase-config.ts` — Auth, Secrets & Storage Buckets

| Tool | Description | Annotations |
|------|-------------|-------------|
| `supabase_get_auth_config` | Get auth settings (providers, JWT expiry, etc.) | readOnly |
| `supabase_update_auth_config` | Update auth configuration | — |
| `supabase_list_secrets` | List project secrets | readOnly |
| `supabase_create_secrets` | Create/update secrets | — |
| `supabase_delete_secrets` | Delete secrets | destructive |
| `supabase_list_storage_buckets` | List storage buckets | readOnly |
| `supabase_get_storage_bucket` | Get bucket details/policies | readOnly |
| `supabase_create_storage_bucket` | Create a storage bucket | — |
| `supabase_update_storage_bucket` | Update bucket settings (public/private, file size limits) | — |
| `supabase_delete_storage_bucket` | Delete a storage bucket | destructive |

**Supabase total: 26 tools across 4 files.**

## Registration — `src/index.ts`

Both providers use conditional registration, identical to Hetzner and Namecheap:

```typescript
// Cloudflare tools
if (isCloudflareConfigured()) {
  registerCloudflareDNSTools(server);
  registerCloudflarePagesTools(server);
  registerCloudflareWorkersTools(server);
  registerCloudflareR2Tools(server);
  registerCloudflareTunnelTools(server);
  registerCloudflareSecurityTools(server);
  console.error("Cloudflare tools registered");
} else {
  console.error("CLOUDFLARE_API_TOKEN/ACCOUNT_ID not set — Cloudflare tools disabled");
}

// Supabase tools
if (isSupabaseConfigured()) {
  registerSupabaseProjectTools(server);
  registerSupabaseDatabaseTools(server);
  registerSupabaseFunctionTools(server);
  registerSupabaseConfigTools(server);
  console.error("Supabase tools registered");
} else {
  console.error("SUPABASE_ACCESS_TOKEN not set — Supabase tools disabled");
}
```

Startup log updated to show status for all six providers.

## BWS Integration — `start.sh`

Add after the Namecheap section:

```bash
# ── Cloudflare API (optional) ────────────────────────────────────
if [ -n "${BWS_CLOUDFLARE_SECRET_ID:-}" ]; then
  export CLOUDFLARE_API_TOKEN=$(fetch_bws_secret "$BWS_CLOUDFLARE_SECRET_ID")
  if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    echo "Cloudflare API token loaded from BWS" >&2
  else
    echo "WARN: BWS_CLOUDFLARE_SECRET_ID set but failed to fetch token" >&2
  fi
fi

# ── Supabase Management API (optional) ───────────────────────────
if [ -n "${BWS_SUPABASE_SECRET_ID:-}" ]; then
  export SUPABASE_ACCESS_TOKEN=$(fetch_bws_secret "$BWS_SUPABASE_SECRET_ID")
  if [ -n "$SUPABASE_ACCESS_TOKEN" ]; then
    echo "Supabase access token loaded from BWS" >&2
  else
    echo "WARN: BWS_SUPABASE_SECRET_ID set but failed to fetch token" >&2
  fi
fi
```

`CLOUDFLARE_ACCOUNT_ID` is passed as a plain env var in `.mcp.json` (not a secret).

## Plugin Config — `.mcp.json`

Add to the `env` block:

```json
"BWS_CLOUDFLARE_SECRET_ID": "<bws-secret-id>",
"CLOUDFLARE_ACCOUNT_ID": "<cloudflare-account-id>",
"BWS_SUPABASE_SECRET_ID": "<bws-secret-id>"
```

## File Summary

| Type | Files | Count |
|------|-------|-------|
| **New client services** | `cloudflare-client.ts`, `supabase-client.ts` | 2 |
| **New tool files** | `cloudflare-dns.ts`, `cloudflare-pages.ts`, `cloudflare-workers.ts`, `cloudflare-r2.ts`, `cloudflare-tunnels.ts`, `cloudflare-security.ts`, `supabase-projects.ts`, `supabase-database.ts`, `supabase-functions.ts`, `supabase-config.ts` | 10 |
| **Modified** | `index.ts`, `start.sh`, `package.json` | 3 |
| **Total new tools** | 37 Cloudflare + 26 Supabase | 63 |
| **New dependencies** | None | 0 |

## Out of Scope

- Supabase data-plane operations (user admin, storage objects) requiring `service_role` key
- Cloudflare Worker script upload (multipart form upload — complex, low priority for v1)
- Cloudflare Zero Trust / Access (large API surface, add later if needed)
- R2 object operations (uses S3-compatible API, not the v4 REST API)
- Cross-provider workflows (e.g., "deploy to Coolify and update Cloudflare DNS") — the tools enable this through sequential LLM calls, but no single compound tool
