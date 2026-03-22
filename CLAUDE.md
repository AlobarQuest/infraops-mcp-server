# InfraOps MCP Server

Multi-provider MCP server for infrastructure operations (v3.0.0). TypeScript, Node.js 18+, stdio transport.

## Quick Reference

- **Build:** `npm run build` (tsc → dist/)
- **Dev:** `npm run dev` (tsx watch)
- **Entry:** `src/index.ts` → `dist/index.js`
- **No tests yet**

## Architecture

```
src/
├── index.ts              # Server init, conditional provider registration
├── constants.ts          # CHARACTER_LIMIT (25K), DEFAULT_LIMIT, REQUEST_TIMEOUT
├── types.ts              # Coolify API response interfaces
├── schemas/common.ts     # Shared Zod schemas (UUID, pagination, response format)
├── services/             # API clients (one per provider)
│   ├── coolify-client.ts
│   ├── hetzner-client.ts
│   ├── cloudflare-client.ts
│   ├── namecheap-client.ts
│   ├── supabase-client.ts
│   └── ssh-client.ts
└── tools/                # Tool registration modules (registerXxxTools functions)
    ├── projects.ts, applications.ts, deployments.ts, env-vars.ts,
    │   databases.ts, servers.ts, services.ts, control.ts     # Coolify (34 tools)
    ├── hetzner-servers.ts, hetzner-networking.ts              # Hetzner (26 tools)
    ├── vps.ts                                                 # VPS SSH (7 tools)
    ├── namecheap-domains.ts, namecheap-dns.ts                 # Namecheap (19 tools)
    ├── cloudflare-dns.ts, cloudflare-pages.ts,
    │   cloudflare-workers.ts, cloudflare-r2.ts,
    │   cloudflare-tunnels.ts, cloudflare-security.ts          # Cloudflare (44 tools)
    └── supabase-projects.ts, supabase-database.ts,
        supabase-functions.ts, supabase-config.ts              # Supabase (28 tools)
```

**166 tools total** across 6 providers.

## Providers

| Provider | Prefix | Always On | Env Vars Required |
|----------|--------|-----------|-------------------|
| Coolify | `coolify_` | Yes | `COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN` |
| VPS SSH | `vps_` | Yes | None (defaults to 178.156.247.239) |
| Hetzner | `hetzner_` | No | `HETZNER_API_TOKEN` |
| Namecheap | `namecheap_` | No | `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_PROXY_TOKEN` |
| Cloudflare | `cloudflare_` | No | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Supabase | `supabase_` | No | `SUPABASE_ACCESS_TOKEN` |

Optional providers only register their tools when their env vars are set.

## Patterns

- Tools use `server.registerTool()` with Zod input schemas
- Each tool file exports a `registerXxxTools(server: McpServer)` function
- Clients handle HTTP requests + error formatting; tools handle schema + response shaping
- Response character limit of 25K to avoid flooding LLM context
- Namecheap uses a proxy service (`namecheap-proxy`) for IP whitelisting — not direct API

## Adding a New Provider

1. Create `src/services/<provider>-client.ts` with `isXxxConfigured()` export
2. Create `src/tools/<provider>-<feature>.ts` with `registerXxx(server)` export
3. Import and conditionally register in `src/index.ts`
4. Prefix all tool names with `<provider>_` to avoid collisions

## Secrets

All secrets come from BWS (Bitwarden Secrets Manager) via start.sh. Never hardcode tokens.
