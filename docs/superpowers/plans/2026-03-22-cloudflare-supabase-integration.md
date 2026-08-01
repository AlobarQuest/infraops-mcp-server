# Cloudflare & Supabase Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloudflare (44 tools) and Supabase (28 tools) as direct providers in infraops-mcp-server, following the existing Hetzner/Coolify/Namecheap pattern.

**Architecture:** Both providers use singleton axios clients with bearer token auth, conditional tool registration via env var checks, and BWS secret fetching at startup. No new npm dependencies. Each provider gets a client service file and multiple tool files grouped by resource area.

**Tech Stack:** TypeScript, axios (existing), zod (existing), @modelcontextprotocol/sdk (existing)

**Spec:** `docs/superpowers/specs/2026-03-22-cloudflare-supabase-integration-design.md`

---

## File Map

### New Files

| File                                | Responsibility                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `src/services/cloudflare-client.ts` | Singleton axios client for Cloudflare v4 API, error handler, config check       |
| `src/services/supabase-client.ts`   | Singleton axios client for Supabase Management API, error handler, config check |
| `src/tools/cloudflare-dns.ts`       | 6 tools: zone and DNS record CRUD                                               |
| `src/tools/cloudflare-pages.ts`     | 8 tools: Pages project and deployment management                                |
| `src/tools/cloudflare-workers.ts`   | 12 tools: Workers inspection, KV namespace/key CRUD, D1 query                   |
| `src/tools/cloudflare-r2.ts`        | 4 tools: R2 bucket management                                                   |
| `src/tools/cloudflare-tunnels.ts`   | 6 tools: Tunnel lifecycle and config                                            |
| `src/tools/cloudflare-security.ts`  | 8 tools: SSL settings, WAF rulesets, cache purge                                |
| `src/tools/supabase-projects.ts`    | 9 tools: project lifecycle, orgs, API keys, health                              |
| `src/tools/supabase-database.ts`    | 4 tools: SQL execution, extensions, Postgres config                             |
| `src/tools/supabase-functions.ts`   | 5 tools: Edge Functions CRUD                                                    |
| `src/tools/supabase-config.ts`      | 10 tools: auth config, secrets, storage buckets                                 |

### Modified Files

| File           | Changes                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts` | Import + conditional registration for both providers, version bump to 3.0.0, updated header comment and startup log |
| `start.sh`     | BWS fetch blocks for `CLOUDFLARE_API_TOKEN` and `SUPABASE_ACCESS_TOKEN`                                             |
| `package.json` | Version bump `2.0.0` → `3.0.0`                                                                                      |

---

## Task 1: Cloudflare Client Service

**Files:**

- Create: `src/services/cloudflare-client.ts`

- [ ] **Step 1: Create the Cloudflare client service**

Follow the exact pattern from `src/services/hetzner-client.ts`. Key differences: Cloudflare uses a different error response format (`{ success, errors, messages, result }`), needs PATCH support, needs `getAccountId()` helper, and checks two env vars for `isCloudflareConfigured()`.

```typescript
/**
 * Cloudflare API client.
 *
 * Wraps the Cloudflare REST API at https://api.cloudflare.com/client/v4.
 * Used for DNS, Pages, Workers, R2, Tunnels, WAF, and SSL management.
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { REQUEST_TIMEOUT } from '../constants.js';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

// ── Singleton client ─────────────────────────────────────────────────

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (_client) return _client;

  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error(
      'CLOUDFLARE_API_TOKEN environment variable is required. ' +
        'Create a scoped API token at https://dash.cloudflare.com/profile/api-tokens. ' +
        'Store it in BWS and set BWS_CLOUDFLARE_SECRET_ID in your MCP config.',
    );
  }

  _client = axios.create({
    baseURL: CLOUDFLARE_API_BASE,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return _client;
}

/** Get the configured Cloudflare account ID */
export function getAccountId(): string {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) {
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID environment variable is required. ' +
        'Find it at https://dash.cloudflare.com → any zone → Overview → right sidebar.',
    );
  }
  return id;
}

// ── Public helpers ───────────────────────────────────────────────────

export async function cloudflareGet<T>(
  endpoint: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const response = await client.get<T>(endpoint, { params });
  return response.data;
}

export async function cloudflarePost<T>(
  endpoint: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const response = await client.post<T>(endpoint, data);
  return response.data;
}

export async function cloudflarePut<T>(
  endpoint: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const response = await client.put<T>(endpoint, data);
  return response.data;
}

export async function cloudflarePatch<T>(
  endpoint: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const response = await client.patch<T>(endpoint, data);
  return response.data;
}

export async function cloudflareDelete<T>(endpoint: string): Promise<T> {
  const client = getClient();
  const response = await client.delete<T>(endpoint);
  return response.data;
}

// ── Error handler ────────────────────────────────────────────────────

interface CloudflareErrorBody {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
}

export function handleCloudflareError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError<CloudflareErrorBody>;

    if (axErr.response) {
      const status = axErr.response.status;
      const body = axErr.response.data;
      const cfErrors = body?.errors;
      const msg = cfErrors?.length
        ? cfErrors.map((e) => `[${e.code}] ${e.message}`).join('; ')
        : JSON.stringify(body);

      switch (status) {
        case 400:
          return `Error: Cloudflare bad request. ${msg}`;
        case 401:
          return (
            'Error: Cloudflare authentication failed. Your CLOUDFLARE_API_TOKEN may be invalid or expired. ' +
            'Regenerate it at https://dash.cloudflare.com/profile/api-tokens.'
          );
        case 403:
          return `Error: Cloudflare permission denied. Your API token may lack the required scope. ${msg}`;
        case 404:
          return `Error: Cloudflare resource not found. ${msg}`;
        case 409:
          return `Error: Cloudflare conflict. ${msg}`;
        case 422:
          return `Error: Cloudflare validation failed. ${msg}`;
        case 429:
          return 'Error: Cloudflare rate limit exceeded (1,200 req / 5 min). Wait before retrying.';
        default:
          return `Error: Cloudflare API returned HTTP ${status}. ${msg}`;
      }
    }

    if (axErr.code === 'ECONNABORTED') {
      return 'Error: Cloudflare API request timed out.';
    }
  }

  return `Error: Unexpected Cloudflare error — ${error instanceof Error ? error.message : String(error)}`;
}

/** Check if Cloudflare API is configured */
export function isCloudflareConfigured(): boolean {
  return !!process.env.CLOUDFLARE_API_TOKEN && !!process.env.CLOUDFLARE_ACCOUNT_ID;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/services/cloudflare-client.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/cloudflare-client.ts
git commit -m "feat: add Cloudflare API client service"
```

---

## Task 2: Supabase Client Service

**Files:**

- Create: `src/services/supabase-client.ts`

- [ ] **Step 1: Create the Supabase client service**

Same pattern as Cloudflare client but with Supabase-specific error format and a `supabaseDelete` that accepts an optional body.

```typescript
/**
 * Supabase Management API client.
 *
 * Wraps the Supabase Management API at https://api.supabase.com/v1.
 * Used for project lifecycle, database queries, Edge Functions,
 * secrets, auth config, and storage bucket management.
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { REQUEST_TIMEOUT } from '../constants.js';

const SUPABASE_API_BASE = 'https://api.supabase.com/v1';

// ── Singleton client ─────────────────────────────────────────────────

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (_client) return _client;

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'SUPABASE_ACCESS_TOKEN environment variable is required. ' +
        'Generate a Personal Access Token at https://supabase.com/dashboard/account/tokens. ' +
        'Store it in BWS and set BWS_SUPABASE_SECRET_ID in your MCP config.',
    );
  }

  _client = axios.create({
    baseURL: SUPABASE_API_BASE,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return _client;
}

// ── Public helpers ───────────────────────────────────────────────────

export async function supabaseGet<T>(
  endpoint: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const response = await client.get<T>(endpoint, { params });
  return response.data;
}

export async function supabasePost<T>(
  endpoint: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const response = await client.post<T>(endpoint, data);
  return response.data;
}

export async function supabasePut<T>(endpoint: string, data?: Record<string, unknown>): Promise<T> {
  const client = getClient();
  const response = await client.put<T>(endpoint, data);
  return response.data;
}

export async function supabasePatch<T>(
  endpoint: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const response = await client.patch<T>(endpoint, data);
  return response.data;
}

export async function supabaseDelete<T>(
  endpoint: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const client = getClient();
  const response = await client.delete<T>(endpoint, { data });
  return response.data;
}

// ── Error handler ────────────────────────────────────────────────────

export function handleSupabaseError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError<{ message?: string; error?: string }>;

    if (axErr.response) {
      const status = axErr.response.status;
      const body = axErr.response.data;
      const msg = body?.message ?? body?.error ?? JSON.stringify(body);

      switch (status) {
        case 401:
          return (
            'Error: Supabase authentication failed. Your SUPABASE_ACCESS_TOKEN may be invalid or expired. ' +
            'Regenerate it at https://supabase.com/dashboard/account/tokens.'
          );
        case 403:
          return `Error: Supabase permission denied. ${msg}`;
        case 404:
          return `Error: Supabase resource not found. ${msg}`;
        case 422:
          return `Error: Supabase validation failed. ${msg}`;
        case 429:
          return 'Error: Supabase rate limit exceeded. Wait before retrying.';
        default:
          return `Error: Supabase API returned HTTP ${status}. ${msg}`;
      }
    }

    if (axErr.code === 'ECONNABORTED') {
      return 'Error: Supabase API request timed out.';
    }
  }

  return `Error: Unexpected Supabase error — ${error instanceof Error ? error.message : String(error)}`;
}

/** Check if Supabase Management API is configured */
export function isSupabaseConfigured(): boolean {
  return !!process.env.SUPABASE_ACCESS_TOKEN;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/services/supabase-client.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/supabase-client.ts
git commit -m "feat: add Supabase Management API client service"
```

---

## Note on Tool Annotations (applies to Tasks 3-12)

Every tool must include MCP annotations following the pattern in `src/tools/hetzner-servers.ts`. The spec's tool tables define the annotation for each tool:

- **readOnly** → `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }`
- **destructive** → `{ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }`
- **— (default, write/create/update)** → `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }`

Reference the spec table for each tool file to apply the correct annotation.

## Note on Hetzner Registration Consistency

The existing `index.ts` checks `process.env.HETZNER_API_TOKEN` directly (line 72) rather than calling `isHetznerConfigured()`. The new Cloudflare/Supabase blocks use the `isConfigured()` pattern, which is better. When updating `index.ts` in Task 13, also update the Hetzner block to use `isHetznerConfigured()` for consistency.

---

## Task 3: Cloudflare DNS Tools

**Files:**

- Create: `src/tools/cloudflare-dns.ts`

- [ ] **Step 1: Create the DNS tool file**

6 tools: `cloudflare_list_zones`, `cloudflare_get_zone`, `cloudflare_list_dns_records`, `cloudflare_create_dns_record`, `cloudflare_update_dns_record`, `cloudflare_delete_dns_record`.

Follow the pattern from `src/tools/hetzner-servers.ts`:

- Import from `../services/cloudflare-client.js`
- Export a single `registerCloudflareDNSTools(server: McpServer)` function
- Each tool uses try/catch with `handleCloudflareError`
- Zone endpoints: `GET /zones`, `GET /zones/{id}`
- DNS record endpoints: `GET/POST /zones/{zone_id}/dns_records`, `PUT/DELETE /zones/{zone_id}/dns_records/{id}`

Key schemas:

- `cloudflare_list_zones`: optional `name` filter (string)
- `cloudflare_list_dns_records`: required `zone_id` (string), optional `type` (enum: A, AAAA, CNAME, MX, TXT, SRV, NS, CAA), optional `name` (string)
- `cloudflare_create_dns_record`: required `zone_id`, `type`, `name`, `content`; optional `ttl` (number, default 1 = auto), `proxied` (boolean)
- `cloudflare_update_dns_record`: required `zone_id`, `record_id`, `type`, `name`, `content`; optional `ttl`, `proxied`
- `cloudflare_delete_dns_record`: required `zone_id`, `record_id`

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/cloudflare-dns.ts
git commit -m "feat: add Cloudflare DNS tools (6 tools)"
```

---

## Task 4: Cloudflare Pages Tools

**Files:**

- Create: `src/tools/cloudflare-pages.ts`

- [ ] **Step 1: Create the Pages tool file**

8 tools. All account-scoped — use `getAccountId()` from the client.

Endpoints:

- `GET /accounts/{account_id}/pages/projects` — list projects
- `GET /accounts/{account_id}/pages/projects/{name}` — get project
- `POST /accounts/{account_id}/pages/projects` — create project (body: `{ name, production_branch }`)
- `PATCH /accounts/{account_id}/pages/projects/{name}` — update project
- `DELETE /accounts/{account_id}/pages/projects/{name}` — delete project
- `GET /accounts/{account_id}/pages/projects/{name}/deployments` — list deployments
- `GET /accounts/{account_id}/pages/projects/{name}/deployments/{id}` — get deployment
- `POST /accounts/{account_id}/pages/projects/{name}/deployments` — trigger deployment

Key schemas:

- `cloudflare_create_pages_project`: required `name` (string), `production_branch` (string, e.g. "main")
- `cloudflare_update_pages_project`: required `project_name` (string); optional `production_branch`, `build_config` (object with `build_command`, `destination_dir`, `root_dir`)
- `cloudflare_create_pages_deployment`: required `project_name` (string), optional `branch` (string)

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/cloudflare-pages.ts
git commit -m "feat: add Cloudflare Pages tools (8 tools)"
```

---

## Task 5: Cloudflare Workers Tools

**Files:**

- Create: `src/tools/cloudflare-workers.ts`

- [ ] **Step 1: Create the Workers tool file**

12 tools covering Workers inspection, KV namespaces/keys, and D1 databases. All account-scoped.

Endpoints:

- Workers: `GET /accounts/{id}/workers/scripts`, `GET /accounts/{id}/workers/scripts/{name}`, `DELETE /accounts/{id}/workers/scripts/{name}`
- KV: `GET/POST /accounts/{id}/storage/kv/namespaces`, `DELETE /accounts/{id}/storage/kv/namespaces/{ns_id}`, `GET /accounts/{id}/storage/kv/namespaces/{ns_id}/keys`, `GET/PUT/DELETE /accounts/{id}/storage/kv/namespaces/{ns_id}/values/{key}`
- D1: `GET /accounts/{id}/d1/database`, `POST /accounts/{id}/d1/database/{db_id}/query`

Key notes:

- `cloudflare_query_d1` must have `destructiveHint: true` (arbitrary SQL)
- KV `get_kv_value` returns raw text/binary, not JSON — return as text content
- Workers list/get are observation-only (no create/update — multipart upload is out of scope)

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/cloudflare-workers.ts
git commit -m "feat: add Cloudflare Workers, KV, and D1 tools (12 tools)"
```

---

## Task 6: Cloudflare R2 Tools

**Files:**

- Create: `src/tools/cloudflare-r2.ts`

- [ ] **Step 1: Create the R2 tool file**

4 tools. Account-scoped.

Endpoints:

- `GET /accounts/{id}/r2/buckets` — list buckets
- `POST /accounts/{id}/r2/buckets` — create bucket (body: `{ name, locationHint? }`)
- `GET /accounts/{id}/r2/buckets/{name}` — get bucket
- `DELETE /accounts/{id}/r2/buckets/{name}` — delete bucket

Key schemas:

- `cloudflare_create_r2_bucket`: required `name` (string); optional `locationHint` (string, e.g. "wnam", "enam", "weur", "eeur", "apac")

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/cloudflare-r2.ts
git commit -m "feat: add Cloudflare R2 bucket tools (4 tools)"
```

---

## Task 7: Cloudflare Tunnels Tools

**Files:**

- Create: `src/tools/cloudflare-tunnels.ts`

- [ ] **Step 1: Create the Tunnels tool file**

6 tools. Account-scoped. Uses the `cfd_tunnel` endpoints.

Endpoints:

- `GET /accounts/{id}/cfd_tunnel` — list tunnels
- `POST /accounts/{id}/cfd_tunnel` — create tunnel (body: `{ name, tunnel_secret }`)
- `GET /accounts/{id}/cfd_tunnel/{tunnel_id}` — get tunnel
- `DELETE /accounts/{id}/cfd_tunnel/{tunnel_id}` — delete tunnel
- `GET /accounts/{id}/cfd_tunnel/{tunnel_id}/configurations` — get config
- `PUT /accounts/{id}/cfd_tunnel/{tunnel_id}/configurations` — update config

Key schemas:

- `cloudflare_create_tunnel`: required `name` (string), required `tunnel_secret` (string, base64-encoded 32+ byte secret)
- `cloudflare_update_tunnel_config`: required `tunnel_id` (string), required `config` (object with `ingress` array — each entry has `hostname`, `service`, optional `path`)

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/cloudflare-tunnels.ts
git commit -m "feat: add Cloudflare Tunnel tools (6 tools)"
```

---

## Task 8: Cloudflare Security Tools

**Files:**

- Create: `src/tools/cloudflare-security.ts`

- [ ] **Step 1: Create the Security tool file**

8 tools covering SSL settings, WAF rulesets (NOT deprecated firewall rules), and cache purge. Zone-scoped.

Endpoints:

- SSL: `GET/PATCH /zones/{zone_id}/settings/ssl`
- Rulesets: `GET /zones/{zone_id}/rulesets`, `GET /zones/{zone_id}/rulesets/{ruleset_id}`
- Ruleset rules: Rules are managed by updating the ruleset — `PUT /zones/{zone_id}/rulesets/{ruleset_id}` with the full rules array. For create/update/delete of individual rules, fetch the ruleset, modify the rules array, and PUT it back.
- Cache: `POST /zones/{zone_id}/purge_cache`

Key schemas:

- `cloudflare_update_ssl_setting`: required `zone_id`, required `value` (enum: "off", "flexible", "full", "strict")
- `cloudflare_create_ruleset_rule`: required `zone_id`, `ruleset_id`, `expression` (string, Cloudflare filter expression), `action` (string, e.g. "block", "challenge", "skip"), optional `description`
- `cloudflare_purge_cache`: required `zone_id`; optional `purge_everything` (boolean), `files` (array of URLs), `tags` (array of cache tags). At least one purge option required.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/cloudflare-security.ts
git commit -m "feat: add Cloudflare security tools — WAF rulesets, SSL, cache purge (8 tools)"
```

---

## Task 9: Supabase Projects Tools

**Files:**

- Create: `src/tools/supabase-projects.ts`

- [ ] **Step 1: Create the Projects tool file**

9 tools for project lifecycle.

Endpoints:

- `GET /projects` — list all projects
- `GET /projects/{ref}` — get project details
- `POST /projects` — create project (body: `{ name, organization_id, db_pass, region, plan }`)
- `DELETE /projects/{ref}` — delete project (WARNING in description: destroys database and all resources)
- `POST /projects/{ref}/pause` — pause project
- `POST /projects/{ref}/restore` — restore paused project
- `GET /organizations` — list organizations
- `GET /projects/{ref}/api-keys` — get API keys
- `GET /projects/{ref}/health` — get health status

Key schemas:

- `supabase_create_project`: required `name`, `organization_id`, `db_pass` (min 6 chars), `region` (e.g. "us-east-1", "eu-west-1"); optional `plan` (enum: "free", "pro")
- `supabase_delete_project`: required `ref` (string, project reference). Description must include WARNING about irreversible data loss.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/supabase-projects.ts
git commit -m "feat: add Supabase project management tools (9 tools)"
```

---

## Task 10: Supabase Database Tools

**Files:**

- Create: `src/tools/supabase-database.ts`

- [ ] **Step 1: Create the Database tool file**

4 tools for SQL execution and Postgres configuration.

Endpoints:

- `POST /projects/{ref}/database/query` — run SQL (body: `{ query }`)
- `GET /projects/{ref}/database/extensions` — list extensions
- `GET /projects/{ref}/config/database/postgres` — get Postgres config
- `PUT /projects/{ref}/config/database/postgres` — update Postgres config

Key schemas:

- `supabase_run_sql`: required `ref` (project reference), required `query` (string). Must have `destructiveHint: true`. Description should warn that arbitrary SQL can modify or destroy data.
- `supabase_update_postgres_config`: required `ref`; accepts Postgres settings as key-value pairs (e.g. `max_connections`, `statement_timeout`)

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/supabase-database.ts
git commit -m "feat: add Supabase database tools — SQL execution and Postgres config (4 tools)"
```

---

## Task 11: Supabase Functions Tools

**Files:**

- Create: `src/tools/supabase-functions.ts`

- [ ] **Step 1: Create the Functions tool file**

5 tools for Edge Functions management.

Endpoints:

- `GET /projects/{ref}/functions` — list functions
- `GET /projects/{ref}/functions/{slug}` — get function details
- `POST /projects/{ref}/functions` — create function (body: `{ name, slug, body, verify_jwt }`)
- `PATCH /projects/{ref}/functions/{slug}` — update function
- `DELETE /projects/{ref}/functions/{slug}` — delete function

Key schemas:

- `supabase_create_function`: required `ref`, `name`, `slug`; optional `verify_jwt` (boolean, default true), `body` (string — the function source code)
- `supabase_update_function`: required `ref`, `slug`; optional `name`, `verify_jwt`, `body`

**Implementation note:** Verify the Supabase Edge Functions API for create/update — it may require multipart form upload rather than JSON body. Check `https://supabase.com/docs/reference/api` before implementing. If multipart is required, adjust the request handling accordingly (use `FormData` with axios).

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/supabase-functions.ts
git commit -m "feat: add Supabase Edge Functions tools (5 tools)"
```

---

## Task 12: Supabase Config Tools

**Files:**

- Create: `src/tools/supabase-config.ts`

- [ ] **Step 1: Create the Config tool file**

10 tools for auth configuration, secrets, and storage buckets.

Endpoints:

- Auth: `GET/PATCH /projects/{ref}/config/auth`
- Secrets: `GET /projects/{ref}/secrets`, `POST /projects/{ref}/secrets` (create/update), `DELETE /projects/{ref}/secrets` (body: array of secret names)
- Storage: `GET /projects/{ref}/storage/buckets`, `GET /projects/{ref}/storage/buckets/{id}`, `POST /projects/{ref}/storage/buckets`, `PUT /projects/{ref}/storage/buckets/{id}`, `DELETE /projects/{ref}/storage/buckets/{id}`

Key schemas:

- `supabase_update_auth_config`: required `ref`; optional fields for auth settings (e.g. `site_url`, `jwt_expiry`, `external_email_enabled`, etc.) — accept as a generic config object
- `supabase_create_secrets`: required `ref`, required `secrets` (array of `{ name, value }`)
- `supabase_delete_secrets`: required `ref`, required `secrets` (array of secret name strings). Must have `destructiveHint: true`.
- `supabase_create_storage_bucket`: required `ref`, `name`; optional `public` (boolean), `file_size_limit` (number in bytes), `allowed_mime_types` (array of strings)

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/supabase-config.ts
git commit -m "feat: add Supabase config tools — auth, secrets, storage buckets (10 tools)"
```

---

## Task 13: Registration and Infrastructure Updates

**Files:**

- Modify: `src/index.ts`
- Modify: `start.sh`
- Modify: `package.json`

- [ ] **Step 1: Update `src/index.ts`**

Add imports for all new tool registration functions and both client `isConfigured` checks. Add conditional registration blocks for Cloudflare (6 register calls) and Supabase (4 register calls) after the Namecheap section. Update:

- Header comment: add Cloudflare and Supabase to the provider list
- Version in `McpServer` constructor: `"3.0.0"`
- Startup log string: `"InfraOps MCP server v3.0.0 running via stdio"`
- Add Cloudflare and Supabase status lines to the startup log

See the spec's "Registration" section for the exact code block.

- [ ] **Step 2: Update `start.sh`**

Add two new BWS fetch blocks after the Namecheap section. See the spec's "BWS Integration" section for the exact bash code. The pattern matches the existing Hetzner block.

- [ ] **Step 3: Update `package.json` version**

Change `"version": "1.0.0"` to `"version": "3.0.0"`. (Note: `package.json` is at 1.0.0 while `index.ts` references 2.0.0 in the McpServer constructor — this task aligns both to 3.0.0.)

- [ ] **Step 4: Verify full project compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/index.ts start.sh package.json
git commit -m "feat: register Cloudflare and Supabase providers, bump to v3.0.0"
```

---

## Task 14: Build and Smoke Test

**Files:**

- No new files

- [ ] **Step 1: Clean build**

```bash
npm run clean && npm run build
```

Expected: Clean compilation to `dist/`, no errors.

- [ ] **Step 2: Verify server starts with no provider tokens**

```bash
COOLIFY_BASE_URL=http://localhost COOLIFY_API_TOKEN=test node dist/index.js 2>&1 | head -20
```

Expected: Server starts, logs show Cloudflare and Supabase as "not configured" (disabled), no crashes. The server should still function for Coolify tools.

Kill the process after verifying.

- [ ] **Step 3: Verify tool count**

Start the server and use MCP inspector or count registered tools to verify 72 new tools are registered when all env vars are set. Alternatively, check that the tool registration functions are called by reviewing the stderr output.

- [ ] **Step 4: Commit dist**

```bash
git add dist/
git commit -m "build: rebuild dist for v3.0.0 with Cloudflare and Supabase providers"
```

---

## Task 15: Plugin Config Update

**Files:**

- Modify: `/Users/devon/Projects/devon-plugins/infraops/.mcp.json`

- [ ] **Step 1: Add new env vars to plugin config**

Add to the `env` block in `.mcp.json`:

```json
"BWS_CLOUDFLARE_SECRET_ID": "<to-be-filled>",
"CLOUDFLARE_ACCOUNT_ID": "<to-be-filled>",
"BWS_SUPABASE_SECRET_ID": "<to-be-filled>"
```

The actual BWS secret IDs and Cloudflare account ID need to be filled in by the user after:

1. Creating a Cloudflare API token and storing it in BWS
2. Creating a Supabase PAT and storing it in BWS
3. Looking up the Cloudflare account ID from the dashboard

- [ ] **Step 2: Copy updated dist to plugin**

The plugin at `devon-plugins/infraops/server/` needs the updated dist files. Copy the rebuilt `dist/` directory and any new source files.

- [ ] **Step 3: Commit plugin changes**

```bash
cd /Users/devon/Projects/devon-plugins
git add infraops/
git commit -m "feat: update infraops plugin with Cloudflare and Supabase providers (v3.0.0)"
```
