# InfraOps MCP Server

A Model Context Protocol server that exposes infrastructure operations as
callable tools for Claude Code. Runs locally over stdio — no HTTP server,
no container, no remote deployment.

**This is the "doer."** For infrastructure standards and deployment patterns
see the `infra-brain` MCP. For application-level context see `app-brain`.

## Providers

| Provider      | Prefix        | Tools | Always on | Required env                                                         |
| ------------- | ------------- | ----- | --------- | -------------------------------------------------------------------- |
| Coolify       | `coolify_`    | 67    | ✅        | `COOLIFY_PROD_BASE_URL` + `COOLIFY_PROD_API_TOKEN`                   |
| VPS (SSH/orb) | `vps_`        | 7     | ✅        | — (defaults route to Hetzner prod)                                   |
| Hetzner Cloud | `hetzner_`    | 26    | ❌        | `HETZNER_API_TOKEN`                                                  |
| Namecheap     | `namecheap_`  | 19    | ❌        | `NAMECHEAP_API_USER` + `NAMECHEAP_API_KEY` + `NAMECHEAP_PROXY_TOKEN` |
| Cloudflare    | `cloudflare_` | 44    | ❌        | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`                     |
| Supabase      | `supabase_`   | 28    | ❌        | `SUPABASE_ACCESS_TOKEN`                                              |
| GitHub        | `github_`     | 4     | ❌        | `GITHUB_TOKEN`                                                       |

**195 tools across 7 providers.** Coolify and VPS register unconditionally;
optional providers register only when their env vars are present at startup.

Coolify and VPS tools both accept an `instance: "prod" | "dev"` parameter
that routes between the Hetzner production VPS and a local OrbStack dev VM.
Tool implementations live in `src/tools/` — schemas are defined inline via
Zod in each tool file.

## Quickstart

```bash
npm ci
npm run build
npm test        # vitest, 15 tests
```

The server is launched by Claude Code as a subprocess via `start.sh`, which
fetches secrets from Bitwarden Secrets Manager (BWS) and execs
`node dist/index.js`. To run it standalone (e.g. for debugging), invoke
`start.sh` from a shell that has `BWS_ACCESS_TOKEN` set.

## Where to Look

| Document                                                 | What's in it                                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`CLAUDE.md`](./CLAUDE.md)                               | Architecture map, patterns, per-provider notes, private-repo deploy workflow, compose app config, secrets policy. The canonical "how this works" doc.              |
| [`RUNBOOK.md`](./RUNBOOK.md)                             | Local setup, dev workflow, CI/CD, provider configuration, secret management, `.claude.json` example, troubleshooting. The canonical "how do I use/debug this" doc. |
| [`BACKLOG.md`](./BACKLOG.md)                             | Deferred work with full context — threat models, tradeoffs, acceptance criteria — designed to be resumed cold in a future session.                                 |
| [`INFRAOPS_IMPROVEMENTS.md`](./INFRAOPS_IMPROVEMENTS.md) | Historical design doc for the v3.2.0 deploy-key / GitHub / compose work. Retained as context. Most items shipped; one remains open and is tracked in `BACKLOG.md`. |

## Versioning

Current version: **3.3.0** (see `package.json`). Minor bumps track
user-visible tool API surface changes (new tools, new parameters); patch
bumps track bug fixes. CI runs `tsc` as the type-check gate on every push
to `main` via `.github/workflows/build.yml`.
