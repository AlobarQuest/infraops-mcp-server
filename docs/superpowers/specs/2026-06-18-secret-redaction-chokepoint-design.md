# Central secret-redaction chokepoint for MCP tool responses

**Date:** 2026-06-18
**Status:** Design (approved)
**Author:** Devon + Claude

## Problem

`coolify_get_deployment` returns a **private GitHub deploy key** in its response — the raw
`/deployments/{uuid}` API object is serialized whole via `jsonResponse`, and the PEM key is a
field the `CoolifyDeployment` TS type never declares. A static audit (2026-06-18) showed this is
**one instance of a systemic leak class**: most tools `JSON.stringify` the raw provider API
response, the TS types are partial projections, and redaction today is three uncomposed
mechanisms covering only 5 field names, shallow, on 2 of ~30 tool files. Cloudflare / Supabase /
Hetzner / Namecheap tools have **no redaction path at all**.

### Audit findings (the leak surface)

Ranked by blast radius:

| #   | Tools                                                                                                                              | Secret                                                         | Today                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| 1   | `coolify_get_database` / `list_databases` / `create_database` / `update_database` / `overview(summary:false)` / `server_resources` | plaintext DB passwords + connection URLs (every Flavor B/C DB) | unmasked                                    |
| 2   | `coolify_get_deployment` / `list_deployments`                                                                                      | PEM private deploy key (trigger)                               | unmasked                                    |
| 3   | `supabase_get_api_keys`, `supabase_get_auth_config` / `update_auth_config`                                                         | service_role key, JWT secret, SMTP pass                        | returned unconditionally, no `reveal` gate  |
| 4   | `coolify_create/update_application`, `set_compose_config`, `create/update_service`                                                 | webhook HMAC secrets (forging risk)                            | `get`/`list` mask these; mutate paths don't |
| 5   | `hetzner_create_server` (root password), `cloudflare_create_tunnel` (connector token + `tunnel_secret`)                            | —                                                              | unmasked                                    |
| 6   | `coolify_get_github_app` family                                                                                                    | `client_secret` / `webhook_secret`                             | likely, unmasked                            |

Existing redaction: `src/utils/masking.ts` (`maskSensitive`, 5 field names, top-level only, used in
`applications.ts` + `services.ts`); `env-vars.ts` (`value`/`real_value`); `private-keys.ts` (manual
`private_key` strip — the correct precedent). `jsonResponse` does no redaction (char-limit only).

**Structural gaps:** mask is shallow (misses eager-loaded child relations); allow-list omits
`private_key`/passwords/tokens; create/update tools echo freshly-generated secrets; cross-provider
tools bypass redaction entirely. Trusting the declared TS type under-reports — the real API returns
more than the type lists.

## Goal

A **single central chokepoint** every tool response passes through, redacting secrets by default,
with an audited `reveal` opt-out and an always-bypass list for tools whose output _is_ the
requested content. Closes the whole class — including untyped future surprises — at one point.

## Non-goals

- Not removing the existing local masks (`private-keys.ts` strip, `maskSensitive`, env-var masking)
  — they stay as defense-in-depth; the central layer is a **superset backstop**.
- Not redacting tools whose purpose is returning raw content (the always-bypass registry).
- Not rotating already-exposed secrets — tracked separately (the visible deploy key must be rotated;
  scope others against the audit log).

## Approach: patch `registerTool` once

All ~213 tools share one `McpServer` instance (`index.ts:93`); each tool file calls
`server.registerTool` directly. Patch `server.registerTool` **once** in `index.ts`, before the
`registerXxxTools(server)` calls. The patch, applied to every current and future tool:

1. **Injects an optional `reveal: boolean` into the tool's input schema** — so every tool supports
   reveal with zero per-file edits. Inject **only if the tool's schema does not already declare
   `reveal`** (`applications`/`services`/`env` tools already do) — injecting a duplicate field would
   break their Zod schema. Both paths read the same `args.reveal`.
2. **Wraps the handler** so its result passes through the sanitizer before returning. This applies to
   **both success and error results** — an error message can echo a secret (e.g. a failed request URL
   containing a token), so error `content` is sanitized too (the always-bypass registry still applies).

Zero per-file churn; a new tool added later is covered automatically.

## Components & boundaries

| Unit                                                      | Responsibility                                                                                                  | Notes                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `src/utils/redaction.ts` (new)                            | Pure redaction logic: `deepRedact(obj)`, `redactText(str)`, name + value-shape rule sets, false-positive guards | No I/O; fully unit-tested    |
| `src/utils/register-sanitized.ts` (new)                   | `wrapRegisterTool(server)` — patches `registerTool`: schema `reveal` injection + handler wrap + gating          | The chokepoint               |
| `ALWAYS_BYPASS` registry (in register-sanitized)          | named `Set` of value-read tool names                                                                            | see below                    |
| `src/utils/response.ts` (`jsonResponse`)                  | adjusted so truncation runs **after** redaction                                                                 | redact-before-truncate       |
| existing `masking.ts` / `env-vars.ts` / `private-keys.ts` | unchanged — defense-in-depth                                                                                    | central layer supersets them |

## The sanitizer (`redaction.ts`)

For each `content[].text` item:

- **Parses as JSON →** `deepRedact` recursively, re-serialize.
- **Not JSON (logs/plain) →** `redactText` value-shape regex on the raw string.

**Balanced posture — two rule sets:**

1. **Name-based** (value → `"***"`), case-insensitive, anchored:
   - Redact when the field name matches: `private_key`, `*password`, `*_secret` / `*secret`,
     `*_token` / `*token`, `service_role*`, `jwt_secret`, `client_secret`, `tunnel_secret`,
     `root_password`, `credentials`, plus the existing 5 (`manual_webhook_secret_*`,
     `http_basic_auth_password`).
   - **Never redact (guards):** `public_key`, `key_name`, `*_id`, `*_uuid`, `*_url` (unless the value
     itself carries an embedded credential — handled by value-shape), `*_fingerprint`, `*_name`,
     `*_at`, `private_key_id`, `private_key_uuid`.
2. **Value-shape** (redact the value regardless of field name):
   - PEM private key: from `-----BEGIN [A-Z ]*PRIVATE KEY-----` to the matching END **or
     end-of-string** (so a truncated key head is still redacted).
   - JWT: three base64url segments `xxxxx.yyyyy.zzzzz` (catches Supabase anon/service_role keys).
   - Known token prefixes: `ghp_`, `github_pat_`, `gho_`, `sk-`, `sk-ant-`, and similar.
   - Connection-string passwords: `scheme://user:PASSWORD@host` → redact the password segment.
   - **Guard:** SSH _public_ material (`ssh-ed25519 AAAA…`, `ssh-rsa AAAA…`) is NOT redacted —
     value-shape keys on `BEGIN…PRIVATE KEY`, and the name guard protects `public_key`. (Critical:
     `coolify_create_private_key` returns a public key and must keep working.)

## Ordering — redact before truncate

Redaction operates on the structured object **before** the 25K truncation, so a secret can never be
split across the truncation boundary. `jsonResponse` is adjusted so the wrapper performs final
truncation after redaction. Non-JSON text uses the END-or-EOS PEM pattern as the truncation-safe path.

## The 3-tier opt-out model

1. **Default:** sanitize.
2. **Per-call `reveal: true`:** the wrapper reads `args.reveal`; if `true`, return the result
   unredacted for that call. For tools where seeing the secret is a real occasional need. Move
   `supabase_get_api_keys` _behind_ `reveal` (today ungated).
3. **Always-bypass registry** — tools whose output IS the requested content, where redaction would
   break them: `vps_read_file`, `vps_exec`, `vps_docker_logs`, `cloudflare_get_kv_value`,
   `cloudflare_query_d1`, `namecheap_domains_get_contacts`. These return raw regardless of `reveal`.

Every bypass is visible in the existing `~/.claude/hooks/high-power-audit-log.sh` trail (the tool
name + `reveal` arg appear in the logged args) — no new audit infrastructure.

## Safety

- **Kill switch:** `INFRAOPS_DISABLE_REDACTION=1` (default unset = redaction ON) disables the central
  layer without a redeploy, in case a false positive ever hides something operationally critical.
- **Defense-in-depth:** existing local masks remain; the central name-list supersets them, so
  removing a local mask cannot silently re-open a hole.

## Testing

`redaction.ts` unit tests (vitest):

- **Redacted:** PEM deploy key (incl. truncated head); Coolify `postgres_password` /
  `redis_password`; connection URL password; Supabase service_role JWT; Hetzner `root_password`;
  Cloudflare `tunnel_secret` + connector token; nested/eager-loaded child object; secret in
  non-JSON log text.
- **Preserved (no false positive):** `public_key`, `key_name`, `private_key_id`, `*_uuid`, `*_id`,
  `ssh-ed25519 AAAA…` public key, ordinary config values, URLs without creds.
- **Gating:** `reveal:true` bypasses; `ALWAYS_BYPASS` tool returns raw; kill-switch env disables.

Plus an integration test that the patched `registerTool` redacts a representative handler's output
and injects the `reveal` schema field.

## Rollout

Redaction is ON by default on merge. The existing daily security-drift run is unaffected (internal
callers use the client helpers directly, not the MCP tool boundary). The visible deploy key is
rotated separately (out of scope here).
