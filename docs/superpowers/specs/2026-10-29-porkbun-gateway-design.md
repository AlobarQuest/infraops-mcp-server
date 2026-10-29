# Porkbun provider: lazy gateway to the official Porkbun MCP server

Status: draft for approval, 2026-10-29.

## Intent

Devon manages some domains at Porkbun alongside the existing Namecheap account. Agents
need to manage everything on those Porkbun domains that the account's API key can reach:
domains, nameservers, glue records, URL forwarding, contacts, DNS records, DNSSEC, DNS
restore points, SSL bundles, email forwarding and mailboxes, webhooks, hosting, and
Porkbun's Cloudflare connect feature.

Porkbun ships and maintains an official MCP server, `@porkbunllc/mcp-server` (MIT,
version 0.54.0 on 2026-10-28, 120 tools, every tool annotated with `readOnlyHint`).
Rather than re-implement about 115 API operations and chase Porkbun's release pace
(the API is at version 3.65), infraops adds a small **gateway**: a few infraops tools that
start Porkbun's server as a child process on first use and forward calls to it. Every call
still goes through infraops, so the central redaction wrapper and the high-power audit log
cover it.

## Why this shape

infraops runs in nearly every Claude Code session on this machine. Two constraints follow:

1. **Weight.** Each infraops tool name appears in every session's tool list. One tool per
   Porkbun operation would add about 80–120 names. The gateway adds three.
2. **Live use.** Every session runs infraops from the main checkout's `dist/`. A bad build or
   a startup crash breaks infra tooling everywhere.

Running Porkbun's server standalone was rejected because it would sit outside infraops'
audit and redaction, the same reason the standalone `coolify-1`/`coolify-dev` servers were
retired. Writing native per-operation tools was rejected because of maintenance cost.

## Goals

- Agents can discover and call every Porkbun tool the key's scopes allow, through infraops.
- Adds three tool names to infraops, and no Porkbun child process until the first Porkbun call.
- Read and write calls go through separate tools, so the audit log and permission
  annotations stay honest.
- Responses go through infraops redaction; secret-bearing responses stay masked unless the
  caller passes `reveal: true`.
- A Porkbun failure of any kind (missing keys, the child failing to start, the child crashing)
  disables or fails only Porkbun calls, never infraops startup or other providers.

## Non-goals

- Replacing or changing the Namecheap provider. Both providers stay.
- Spending money. Devon's key has no `purchase` or `funding` scope. The gateway also blocks
  the purchase and top-up tools by name, so a future key with broader scopes still can't spend
  through infraops.
- Sandbox, mock, and API-key-request tooling.
- A general-purpose MCP gateway for other providers. Build it Porkbun-specific; generalize
  later if a second case appears.

## Anti-goals (failure even if it works)

- infraops fails to start, or starts slower, because of Porkbun.
- A Porkbun secret (SSL private key, webhook signing secret, WordPress application password,
  API keys) lands in a transcript without an explicit `reveal: true`.
- The child process inherits infraops' environment (Coolify, Cloudflare, GitHub, Hetzner,
  and Supabase tokens).
- The child's code changes without a reviewed commit (for example, `npx` fetching "latest"
  at runtime).

## Design

### Tools

All three tools register only when `PORKBUN_API_KEY` and `PORKBUN_SECRET_API_KEY` are set
(the same conditional-registration pattern as the other optional providers).

| Tool | `readOnlyHint` | Purpose |
|---|---|---|
| `porkbun_list_tools` | true | Lists the allowed child tools: name, description, read or write, and input schema. Takes an optional name filter so an agent can fetch one schema without the whole list. |
| `porkbun_read` | true | Calls a child tool whose `readOnlyHint` is true. Input: `tool` (name), `arguments` (object). |
| `porkbun_write` | false | Calls a child tool whose `readOnlyHint` is not true. Same input. |

The gateway refuses a call when the named tool is in the wrong tool (a write through
`porkbun_read`, or the reverse), is on the denylist, or doesn't exist. Each refusal names
the correct tool or the reason.

The child's own annotation decides read versus write. A child tool without annotations
counts as a write.

### Denylist

The gateway hides these child tools from `porkbun_list_tools` and refuses them in both call
tools. The lists mirror the `SANDBOX`, `TOPUPS`, and `PURCHASES` sets in the package's
`dist/profiles.js` for 0.54.0:

- Sandbox: `create_sandbox_key`, `sandbox_topup`, `sandbox_reset`, `sandbox_trigger_webhook`.
- Top-ups: `top_up_account_credit`, `configure_auto_topup`, `top_up_with_usdc`,
  `get_usdc_topup_status`, `top_up_with_card_mpp`.
- Purchases: `register_domain`, `renew_domain`, `transfer_domain`, `buy_closeout`,
  `create_hosting`, `create_mailbox`, `renew_mailbox`.
- API-key requests: `request_api_key`, `retrieve_api_key`.

The test suite pins the denylist against the installed package. If a package upgrade adds a
tool whose name or description matches a spend pattern (`buy`, `purchase`, `renew`,
`register`, `top_up`, `topup`, `transfer_domain`), the test fails until someone classifies it.

### Child process lifecycle

- **Pinned dependency.** Add `@porkbunllc/mcp-server` as an exact-version dependency
  (`0.54.0`, no caret). Resolve its entry point from `node_modules` and run it with the
  current Node binary (`process.execPath`). Never use `npx`. Upgrades are ordinary reviewed PRs.
- **Lazy start.** The first call to any of the three tools starts the child through the MCP
  SDK's `Client` and `StdioClientTransport` (infraops already depends on
  `@modelcontextprotocol/sdk` ^1.32.1). Concurrent first calls share one start-up promise.
- **Minimal environment.** The child receives only `PATH`, `HOME`, `PORKBUN_API_KEY`, and
  `PORKBUN_SECRET_API_KEY`. In particular it never receives `PORKBUN_X402_PRIVATE_KEY` or
  any other provider's token.
- **Tool cache.** Fetch the child's tool list once per child start and cache it.
- **Crash recovery.** If the child exits, the in-flight call fails with a clear error, and the
  next call starts a fresh child. If the child fails to start three times in a row within
  60 seconds, Porkbun calls return an error for the next 5 minutes instead of re-spawning on
  every call.
- **Timeouts.** Each forwarded call uses infraops' `REQUEST_TIMEOUT`.
- **Shutdown.** The child closes when infraops exits (stdin closes, or SIGTERM or SIGINT), so
  sessions leave no orphaned Porkbun processes.
- **Child stderr.** Forward it to infraops' stderr with a `[porkbun]` prefix. The child must
  never write to infraops' stdout, which carries the MCP protocol.

### Audit log

The high-power audit hook (`~/.claude/hooks/high-power-audit-log.sh`) logs only tool names
that match its `GATED` regex. `porkbun_` isn't in it, so as of 2026-10-29 `porkbun_write`
calls would go unlogged. Add `porkbun_write` to `GATED`. That hook lives in the `~/.claude`
control-plane git repo, not in infraops or security-standards, so the change is a separate
commit there. The logged arguments include `tool`, which records the Porkbun operation.

### Redaction

The child's response passes through infraops' central `installRedaction` wrapper like every
other tool response. Several Porkbun tools return secrets. The ones the package itself
flags (`SECRETS` in `profiles.js`) are `get_ssl_bundle` (certificate private key),
`create_wp_credentials` (WordPress application password), `create_webhook` and
`rotate_webhook_secret` (signing secret), and `setup_mailbox`. Webhook reads also carry a
`secret` field.

The gateway must return the child's `content` blocks (and `isError`) as-is, without
re-serializing them. The child returns one text block holding `JSON.stringify(result, null,
2)` (`dist/server.js`), and the wrapper's `redactTextContent` parses that JSON and
deep-redacts it. Wrapping the child's result in `jsonResponse` again would double-escape it,
so PEM and token value-shapes would no longer match.

Add tests that run representative responses for each of these through the redaction path and
assert the secret is masked by default and visible only with `reveal: true`. The test input
must use the child's real format: a text block whose text is a pretty-printed JSON string,
with the PEM newlines escaped inside it. A test that redacts a plain object proves nothing
about the gateway path. Where the existing name and value-shape rules miss a field (for
example a webhook `secret`, or a mailbox password), extend `src/utils/redaction.ts`. Tests
never call the live API.

`porkbun_read` and `porkbun_write` are not added to `ALWAYS_BYPASS`.

### Weight control

Optional `PORKBUN_TOOL_GROUPS`: a comma-separated list of areas (for example `dns,domains`).
When set, `porkbun_list_tools` and the call tools only expose child tools in those areas. When
unset, every allowed tool is available. The builder decides how to map tools to areas (the
package's tool names and the API spec's tags are both reasonable sources). This setting
changes no tool names, because the three gateway tools always register.

### Secrets and configuration

- Both Porkbun secrets are in the BWS project **Ops / Platform**
  (`26ff7e3e-8769-45ff-885c-b415013b4bbf`), next to the Namecheap secrets, and the infraops
  machine account reads them:
  - `porkbun-api-key`: `27e165db-5d54-4176-94df-b4f201476bed` → `PORKBUN_API_KEY`
  - `porkbun-secret-key`: `28acc253-51e3-4ee1-8a04-b4f2014782fe` → `PORKBUN_SECRET_API_KEY`
- `start.sh` fetches both by UUID with these defaults inline, the same as Namecheap's
  production secrets, overridable with `BWS_PORKBUN_API_KEY_SECRET_ID` and
  `BWS_PORKBUN_SECRET_API_KEY_SECRET_ID`. A failed fetch leaves Porkbun disabled and logs a
  warning; it never exits.
- Add both UUIDs to `.bws-secrets.toml`.
- Add an entry for the Porkbun key pair to this repo's `.cred-consumers.toml` so the
  credential-rotation lane knows it exists. The builder follows the file's existing entries
  for class and consumer fields.

### Documentation

Update `CLAUDE.md` (provider table, architecture tree, tool count), `RUNBOOK.md` (provider
section, secret IDs, troubleshooting for `API_ACCESS_DISABLED`, `INSUFFICIENT_SCOPE`, and
`DOMAIN_NOT_ALLOWED`), and the header comment in `src/index.ts`.

## Building while infraops is live

- All work happens in the worktree `../infraops-mcp-server-porkbun` on branch
  `feat/porkbun-gateway`. The main checkout's `main` and `dist/` stay untouched until merge.
- Wrap Porkbun registration in `src/index.ts` in a `try`/`catch` that logs and continues.
- Each `src/` change ships with its rebuilt `dist/` in the same commit (the CI `Build`
  workflow enforces this).
- **Live verification before merge.** Register the worktree as a temporary second MCP server
  (for example `infraops-porkbun-test`, launched from the worktree's `start.sh`) and run these
  checks against Devon's real key:
  1. `porkbun_list_tools` lists tools and starts exactly one child process.
  2. `ping` succeeds, and its `scopes` include neither `purchase` nor `funding`.
  3. One reversible write on a domain Devon names, with API Access turned on for that domain
     in Porkbun (otherwise it fails with `API_ACCESS_DISABLED`): add a TXT record, read it
     back, delete it.
  4. `get_ssl_bundle` comes back masked, and with `reveal: true` unmasked.
  5. A purchase tool is refused by the gateway.
  6. Killing the child mid-session recovers on the next call.
  7. With the Porkbun secret IDs unset, infraops starts normally with Porkbun disabled.
  Then remove the temporary server.
- **Go-live.** Merge, `git sync` in the main checkout, `/mcp reconnect infraops`.

## Decided by Devon

- Build Porkbun support into infraops as a gateway to Porkbun's official server (option 2 of 3).
- Porkbun is an additional provider; Namecheap stays.
- The key can't spend money.
- Disruption to live infraops use and per-session weight both matter.
- The secrets go into BWS project Ops / Platform.

## Claude's calls (Devon can overrule)

- Three gateway tools with a read/write split, rather than two tools.
- Gateway-level denylist for spend tools, on top of the key's scopes. `cancel_transfer`
  and `update_auto_renew`, which the package calls money-adjacent, stay allowed on purpose:
  auto-renew is ordinary domain management, and the key's lack of `purchase` scope governs
  the rest.
- Exact-version pin instead of `npx` or a caret range.
- Minimal child environment.
- Crash back-off of three failures in 60 seconds, then 5 minutes.
- Porkbun-specific gateway rather than a general one.

## Left to the builder

- Module layout (for example `src/services/porkbun-gateway.ts` and `src/tools/porkbun.ts`).
- The area mapping for `PORKBUN_TOOL_GROUPS`.
- How `porkbun_list_tools` formats output within the 25K character limit.
- Exact error wording.
