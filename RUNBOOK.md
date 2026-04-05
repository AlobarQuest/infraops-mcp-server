# InfraOps MCP Server — Runbook

Version 3.2.0 | TypeScript | stdio transport | Node.js 18+

---

## Table of Contents

1. [Overview](#overview)
2. [Local Setup](#local-setup)
3. [Development](#development)
4. [CI/CD Pipeline](#cicd-pipeline)
5. [Provider Configuration](#provider-configuration)
6. [Secret Management](#secret-management)
7. [Claude Code Integration](#claude-code-integration)
8. [Adding New Providers](#adding-new-providers)
9. [Troubleshooting](#troubleshooting)

---

## Overview

InfraOps MCP Server is a local-only Model Context Protocol server that exposes infrastructure operations as tools to Claude Code. It communicates over stdio — there is no HTTP server, no Docker container, and no Coolify deployment. The process is started by Claude Code as a subprocess.

**178 tools across 7 providers:**

| Provider   | Prefix         | Always On | Tools |
|------------|----------------|-----------|-------|
| Coolify    | `coolify_`     | Yes       | 50    |
| VPS SSH    | `vps_`         | Yes       | 7     |
| Hetzner    | `hetzner_`     | No        | 26    |
| Namecheap  | `namecheap_`   | No        | 19    |
| Cloudflare | `cloudflare_`  | No        | 44    |
| Supabase   | `supabase_`    | No        | 28    |
| GitHub     | `github_`      | No        | 4     |

Coolify and VPS SSH register unconditionally. All other providers register only if their required env vars are present at startup.

---

## Local Setup

### Prerequisites

- Node.js 18 or higher
- `bws` CLI (Bitwarden Secrets Manager) installed and authenticated
- SSH key at `~/.ssh/hetzner_ed25519` (for VPS tools)

### First-time install

```bash
cd /Users/devon/Projects/infraops-mcp-server
npm ci
npm run build
```

`npm ci` installs exact versions from `package-lock.json`. Always use `npm ci` rather than `npm install` to keep the lockfile authoritative.

The compiled output lands in `dist/`. The entry point is `dist/index.js`.

### Verify the build

```bash
node dist/index.js
# Ctrl-C after confirming startup messages appear on stderr
```

Startup messages are written to stderr (not stdout — stdout is reserved for the MCP protocol). You should see lines like:

```
VPS SSH tools registered (host: 178.156.247.239)
GITHUB_TOKEN not set — GitHub tools disabled
InfraOps MCP server v3.2.0 running via stdio
  Coolify prod: https://coolify-1.devonwatkins.com/api/v1
```

Note: running `node dist/index.js` directly without `start.sh` will fail for Coolify because `COOLIFY_API_TOKEN` is not set. Use `start.sh` for normal operation.

---

## Development

### Scripts

| Command         | What it does                                              |
|-----------------|-----------------------------------------------------------|
| `npm run dev`   | Runs `tsx watch src/index.ts` — restarts on file changes  |
| `npm run build` | Runs `tsc` — compiles to `dist/`                          |
| `npm run start` | Runs `node dist/index.js` — requires a prior build        |
| `npm run clean` | Removes `dist/`                                           |

### Dev workflow

`npm run dev` uses `tsx` to run TypeScript directly without a build step. Changes to any file under `src/` trigger an automatic restart. This is useful when iterating on tool implementations.

```bash
npm run dev
```

Because the server uses stdio transport, `npm run dev` is only useful for watching for type errors and startup log output. There is no interactive REPL — the server waits for MCP messages from a client.

### TypeScript configuration

Compiler options of note (`tsconfig.json`):

- `"strict": true` — all strict checks enabled; no implicit any, no implicit returns
- `"target": "ES2022"` — uses native async/await, class fields, top-level await
- `"module": "Node16"` / `"moduleResolution": "Node16"` — requires `.js` extensions on all relative imports in source files
- `"outDir": "./dist"` — compiled output location
- Source maps and declaration maps are generated alongside the compiled JS

The `.js` extension requirement is a common source of confusion: when importing within `src/`, always write the import with `.js` even though the source file is `.ts`:

```typescript
import { registerProjectTools } from "./tools/projects.js";
```

---

## CI/CD Pipeline

The workflow at `.github/workflows/build.yml` runs on every push to `main` and on pull requests targeting `main`.

Steps:
1. `actions/checkout@v4` — checks out the code
2. `actions/setup-node@v4` with Node 18 and npm cache enabled
3. `npm ci` — clean install
4. `npm run build` — TypeScript compilation

The build step (`tsc`) is the type-check gate. If any type error exists, the build fails and the push is rejected. There are no tests yet.

This pipeline does not deploy anything — the server runs locally and is never hosted remotely.

---

## Provider Configuration

### How conditional registration works

`src/index.ts` calls an `isXxxConfigured()` function from each provider's client module before registering its tools. If the check returns false, the tools are skipped entirely and a message is logged to stderr.

Coolify and VPS are exceptions:
- Coolify tools are always registered. If no instances are configured, a warning is logged but the server still starts.
- VPS tools are always registered with no configuration check. Connection details default at call time.

### Environment variables by provider

**Coolify (required)**

```
COOLIFY_PROD_BASE_URL       URL of your production Coolify instance
                            e.g. http://coolify-1.devonwatkins.com
COOLIFY_PROD_API_TOKEN      Bearer token from Coolify UI → Settings → API Tokens

# Legacy aliases (also accepted):
COOLIFY_BASE_URL
COOLIFY_API_TOKEN

# Dev instance (optional):
COOLIFY_DEV_BASE_URL        e.g. http://192.168.139.217:8000
COOLIFY_DEV_API_TOKEN
```

All Coolify tools accept an `instance` parameter (`"prod"` or `"dev"`, defaults to `"prod"`). The dev instance is intended for a local OrbStack VM.

**VPS SSH (no required env vars)**

```
VPS_HOST                    Default: 178.156.247.239
VPS_USER                    Default: root
VPS_SSH_KEY_PATH            Default: ~/.ssh/hetzner_ed25519
VPS_SSH_PASSPHRASE          SSH key passphrase, if the key is encrypted (optional)
```

**GitHub**

```
GITHUB_TOKEN                Personal access token or fine-grained token
                            Required scopes: repo (for deploy key management)
```

**Hetzner**

```
HETZNER_API_TOKEN           API token from Hetzner Cloud Console → Security → API Tokens
```

**Namecheap**

Namecheap requires three values, all fetched from BWS by `start.sh`:

```
NAMECHEAP_API_USER          API username
NAMECHEAP_API_KEY           API key
NAMECHEAP_PROXY_TOKEN       Bearer token for namecheap-proxy.devonwatkins.com
NAMECHEAP_USE_SANDBOX       "true" (default) or "false" for production
```

Namecheap's API requires IP whitelisting. Rather than whitelisting the local machine, requests are routed through `namecheap-proxy.devonwatkins.com`, a VPS-hosted proxy. `NAMECHEAP_PROXY_TOKEN` authenticates against that proxy.

`isNamecheapConfigured()` returns true only when all three of `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, and `NAMECHEAP_PROXY_TOKEN` are set.

**Cloudflare**

```
CLOUDFLARE_API_TOKEN        API token from Cloudflare dashboard → My Profile → API Tokens
CLOUDFLARE_ACCOUNT_ID       Account ID from Cloudflare dashboard sidebar
```

Both must be set for Cloudflare tools to register.

**Supabase**

```
SUPABASE_ACCESS_TOKEN       Personal access token from supabase.com → Account → Access Tokens
```

---

## Secret Management

### How start.sh works

`start.sh` is the production launcher. It:

1. Fetches secrets from BWS at startup
2. Exports them as environment variables
3. `exec`s `node dist/index.js` — replaces the shell process with Node

Because `exec` is used, the shell process disappears and Node inherits all the exported variables. The secrets exist only in memory for the duration of the server process and are never written to disk.

### BWS secret lookup methods

`start.sh` uses two helper functions:

- `fetch_bws_secret <id>` — fetches a secret by its UUID (BWS secret ID)
- `fetch_bws_secret_by_name <name>` — fetches a secret by its key name across all secrets in the vault

Most providers use the ID-based approach. Namecheap uses name-based lookup because the secret names themselves encode the environment (`BWS_NAMECHEAP_SANDBOX_API_USER_SECRET_ID` vs `BWS_NAMECHEAP_PROD_API_USER_SECRET_ID`).

### BWS secret ID mapping

The following env vars in `.claude.json` are secret IDs (UUIDs), not the actual tokens:

| Env var in .claude.json            | What it resolves to              |
|------------------------------------|----------------------------------|
| `BWS_COOLIFY_PROD_SECRET_ID`       | `COOLIFY_API_TOKEN`              |
| `BWS_COOLIFY_DEV_SECRET_ID`        | `COOLIFY_DEV_API_TOKEN`          |
| `BWS_HETZNER_SECRET_ID`            | `HETZNER_API_TOKEN`              |
| `BWS_SSH_PASSPHRASE_SECRET_ID`     | `VPS_SSH_PASSPHRASE`             |
| `BWS_CLOUDFLARE_SECRET_ID`         | `CLOUDFLARE_API_TOKEN`           |
| `BWS_SUPABASE_SECRET_ID`           | `SUPABASE_ACCESS_TOKEN`          |

Namecheap and the Namecheap proxy token are fetched by name — no secret ID env vars are needed for them, just that the BWS vault contains keys named:
- `BWS_NAMECHEAP_SANDBOX_API_USER_SECRET_ID`
- `BWS_NAMECHEAP_SANDBOX_API_KEY_SECRET_ID`
- `BWS_NAMECHEAP_PROD_API_USER_SECRET_ID`
- `BWS_NAMECHEAP_PROD_API_KEY_SECRET_ID`
- `NAMECHEAP_PROXY_BEARER_TOKEN`

### What happens when a secret is missing

- **Coolify token missing:** `start.sh` exits with code 1 immediately, printing an error to stderr. The MCP server never starts.
- **Optional secret missing:** `start.sh` logs a `WARN:` line to stderr and continues. The corresponding provider tools will not register because the env var will be empty.
- **BWS not authenticated:** `bws` commands fail silently (return empty string via `|| echo ""`). This is equivalent to the secret being missing — Coolify will fail hard, others will be skipped.

---

## Claude Code Integration

### Configuration format

The server is configured in `.claude.json` (or the global `~/.claude.json`). The MCP server entry uses `start.sh` as the command:

```json
{
  "mcpServers": {
    "infraops": {
      "command": "/Users/devon/Projects/infraops-mcp-server/start.sh",
      "args": [],
      "env": {
        "COOLIFY_PROD_BASE_URL": "http://coolify-1.devonwatkins.com",
        "BWS_COOLIFY_PROD_SECRET_ID": "<uuid-of-coolify-token-in-bws>",
        "BWS_HETZNER_SECRET_ID": "<uuid-of-hetzner-token-in-bws>",
        "BWS_CLOUDFLARE_SECRET_ID": "<uuid-of-cloudflare-token-in-bws>",
        "CLOUDFLARE_ACCOUNT_ID": "<your-cloudflare-account-id>",
        "BWS_SUPABASE_SECRET_ID": "<uuid-of-supabase-token-in-bws>",
        "BWS_SSH_PASSPHRASE_SECRET_ID": "<uuid-or-empty>",
        "NAMECHEAP_USE_SANDBOX": "true"
      }
    }
  }
}
```

`GITHUB_TOKEN` can be passed directly in `env` if preferred, or fetched from BWS by adding a `BWS_GITHUB_SECRET_ID` entry and a corresponding fetch block in `start.sh`.

### Permissions

Claude Code will prompt for approval the first time each tool is used. To pre-approve all infraops tools, add them to the `permissions` block in `.claude.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__infraops__*"
    ]
  }
}
```

### Reloading after changes

Claude Code spawns the MCP server once per session. After rebuilding (`npm run build`) or changing `start.sh`, restart the Claude Code session (or use `/mcp` to reconnect) to pick up the changes.

---

## Adding New Providers

Follow these four steps:

### Step 1: Create the service client

Create `src/services/<provider>-client.ts`. It must export an `isXxxConfigured()` function and an axios instance or fetch wrapper:

```typescript
// src/services/linear-client.ts

export function isLinearConfigured(): boolean {
  return Boolean(process.env.LINEAR_API_KEY);
}

export async function linearRequest(path: string, body: object): Promise<unknown> {
  const token = process.env.LINEAR_API_KEY;
  if (!token) throw new Error("LINEAR_API_KEY not set");
  // ... axios call
}
```

### Step 2: Create the tool file

Create `src/tools/<provider>-<feature>.ts`. Export a `registerXxxTools(server: McpServer)` function. Name all tools with the provider prefix:

```typescript
// src/tools/linear-issues.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { linearRequest } from "../services/linear-client.js";

export function registerLinearIssueTools(server: McpServer): void {
  server.registerTool(
    "linear_list_issues",
    {
      description: "List Linear issues for a team",
      inputSchema: z.object({
        teamId: z.string().describe("Team ID"),
      }),
    },
    async ({ teamId }) => {
      const result = await linearRequest("/issues", { teamId });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );
}
```

### Step 3: Register in index.ts

Add the import and conditional registration to `src/index.ts`:

```typescript
import { registerLinearIssueTools } from "./tools/linear-issues.js";
import { isLinearConfigured } from "./services/linear-client.js";

// ... after existing registrations:

if (isLinearConfigured()) {
  registerLinearIssueTools(server);
  console.error("Linear tools registered");
} else {
  console.error("LINEAR_API_KEY not set — Linear tools disabled");
}
```

### Step 4: Add the env var to start.sh and .claude.json

Add a fetch block to `start.sh`:

```bash
# ── Linear (optional) ────────────────────────────────────────────
if [ -n "${BWS_LINEAR_SECRET_ID:-}" ]; then
  export LINEAR_API_KEY=$(fetch_bws_secret "$BWS_LINEAR_SECRET_ID")
  if [ -n "$LINEAR_API_KEY" ]; then
    echo "Linear API key loaded from BWS" >&2
  else
    echo "WARN: BWS_LINEAR_SECRET_ID set but failed to fetch token" >&2
  fi
fi
```

Add the BWS secret ID to the `env` block in `.claude.json`:

```json
"BWS_LINEAR_SECRET_ID": "<uuid>"
```

Then rebuild:

```bash
npm run build
```

---

## Troubleshooting

### BWS authentication failure

**Symptom:** `start.sh` exits with `ERROR: Failed to fetch Coolify API token from BWS`.

**Cause:** The `bws` CLI is not authenticated or `BWS_ACCESS_TOKEN` is not in the environment.

**Fix:**
```bash
# Check if bws is authenticated
bws secret list --output json | head -c 100

# If not, set BWS_ACCESS_TOKEN in ~/.zshenv (required for GUI-launched apps)
echo 'export BWS_ACCESS_TOKEN=your-token' >> ~/.zshenv
source ~/.zshenv
```

Note: `.zshrc` is not sourced by GUI-launched applications. Use `~/.zshenv` for any variable that needs to be available to Claude Desktop or Claude Code launched from Spotlight/Dock.

### Provider tools not appearing

**Symptom:** Tools like `hetzner_list_servers` or `cloudflare_list_zones` are not available.

**Cause:** The provider's env var was empty at startup, so its tools were not registered.

**Diagnosis:** Check the server's startup log in Claude Code (`/mcp` menu or session output). Look for lines like:
```
HETZNER_API_TOKEN not set — Hetzner Cloud tools disabled
```

**Fix:**
1. Verify the BWS secret ID in `.claude.json` is correct
2. Verify `bws secret get <id> --output json` returns the expected value
3. Restart the Claude Code session to force a fresh server spawn

### TypeScript build errors

**Symptom:** `npm run build` fails with type errors.

**Common causes and fixes:**

- **Missing `.js` extension on import:** All relative imports in `src/` must use `.js` extension even for `.ts` files. Change `from "./tools/projects"` to `from "./tools/projects.js"`.

- **Implicit `any`:** Strict mode disallows `any` without an explicit annotation. Add explicit types or use `unknown` with a type guard.

- **Zod schema mismatch:** If a tool's `inputSchema` and handler parameter types diverge, TypeScript will error. Keep the Zod schema as the single source of truth and infer types from it with `z.infer<typeof schema>`.

### Tool registration failures at runtime

**Symptom:** The server starts but a specific tool returns an error or is not callable.

**Cause:** `server.registerTool()` may fail if two tools share the same name, or if the Zod schema contains an invalid configuration.

**Diagnosis:** Check stderr output during startup for any uncaught exceptions before "running via stdio" is printed.

**Fix:** Ensure tool names are unique and scoped with the provider prefix. Run `npm run build` to catch Zod/TypeScript mismatches before they reach runtime.

### SSH connection issues (VPS tools)

**Symptom:** `vps_exec` or other VPS tools return SSH connection errors.

**Common causes:**

1. **Wrong key path:** The default key is `~/.ssh/hetzner_ed25519`. If your key is elsewhere, set `VPS_SSH_KEY_PATH` in `.claude.json`'s `env` block.

2. **Key requires passphrase:** Set `BWS_SSH_PASSPHRASE_SECRET_ID` in `.claude.json` to the BWS UUID of the passphrase secret.

3. **Host unreachable:** The VPS IP defaults to `178.156.247.239`. Override with `VPS_HOST` if the IP has changed.

4. **Known hosts mismatch:** If the VPS was rebuilt and the host key changed, clear the old entry:
   ```bash
   ssh-keygen -R 178.156.247.239
   ```
   Then manually SSH once to accept the new host key before using VPS tools.

### Namecheap proxy issues

**Symptom:** Namecheap tools return authentication or connection errors.

**Cause:** Namecheap's API requires IP whitelisting. Direct API calls from a local machine are rejected unless the local IP is whitelisted. The proxy at `namecheap-proxy.devonwatkins.com` routes requests through the VPS (which is whitelisted).

**Diagnosis checklist:**
1. Confirm `NAMECHEAP_PROXY_TOKEN` is non-empty (check start.sh output for "Namecheap proxy token loaded from BWS")
2. Confirm `NAMECHEAP_USE_SANDBOX` matches which credentials you have in BWS (sandbox vs production)
3. Check whether the proxy service on the VPS is running: `vps_exec` with `docker ps | grep namecheap`
4. Confirm the BWS secret named `NAMECHEAP_PROXY_BEARER_TOKEN` exists and matches the token the proxy expects

**Sandbox vs production:** `NAMECHEAP_USE_SANDBOX` defaults to `"true"`. Sandbox credentials are separate from production credentials in BWS. Set `NAMECHEAP_USE_SANDBOX=false` in `.claude.json` env to use production.

### Server does not start (no output)

**Symptom:** Claude Code shows the MCP server as unavailable with no diagnostic output.

**Cause:** `start.sh` is not executable, or the path in `.claude.json` is wrong.

**Fix:**
```bash
chmod +x /Users/devon/Projects/infraops-mcp-server/start.sh

# Verify the path resolves
ls -la /Users/devon/Projects/infraops-mcp-server/start.sh
```

Also verify `dist/index.js` exists. If it does not, run `npm run build` first.

### Coolify multi-instance errors

**Symptom:** A Coolify tool errors with "COOLIFY_DEV_BASE_URL environment variable is required."

**Cause:** A tool call passed `instance: "dev"` but `COOLIFY_DEV_BASE_URL` is not set.

**Fix:** Either set `COOLIFY_DEV_BASE_URL` and `BWS_COOLIFY_DEV_SECRET_ID` in `.claude.json`, or omit the `instance` parameter to use the prod default.
