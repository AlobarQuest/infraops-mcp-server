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

| Tool                 | `readOnlyHint` | Purpose                                                                                                                                                                   |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `porkbun_list_tools` | true           | Lists the allowed child tools: name, description, read or write, and input schema. Takes an optional name filter so an agent can fetch one schema without the whole list. |
| `porkbun_read`       | true           | Calls a child tool whose `readOnlyHint` is true. Input: `tool` (name), `arguments` (object).                                                                              |
| `porkbun_write`      | false          | Calls a child tool whose `readOnlyHint` is not true. Same input.                                                                                                          |

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

The child's stdio entry point serves the sandbox tools too; the denylist is what hides them.

Commit a reviewed classification of every tool the pinned package serves (allowed or denied,
120 tools in 0.54.0). A test lists the installed package's tools and fails if any tool is
missing from the classification, so a package upgrade can't add a tool that nobody reviewed.
A keyword test doesn't work here: spend words such as `renew` and `register` appear in 26
allowed tools' names or descriptions, including `ping` and `list_domains`.

### Child process lifecycle

- **Pinned dependency.** Add `@porkbunllc/mcp-server` as an exact-version dependency
  (`0.54.0`, no caret). Resolve its entry point from `node_modules` and run it with the
  current Node binary (`process.execPath`). Never use `npx`. Upgrades are ordinary reviewed PRs.
- **Lazy start.** The first call to any of the three tools starts the child through the MCP
  SDK's `Client` and `StdioClientTransport` (infraops already depends on
  `@modelcontextprotocol/sdk` ^1.32.1). Concurrent first calls share one start-up promise.
- **Minimal environment.** Pass the child only `PORKBUN_API_KEY` and
  `PORKBUN_SECRET_API_KEY`. The SDK's `StdioClientTransport` also merges in its default
  environment (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`), none of which hold
  credentials. The child never receives `PORKBUN_X402_PRIVATE_KEY` or any other provider's
  token.
- **Entry point.** The package has no `main` or `exports` field, only `bin`. Resolve
  `@porkbunllc/mcp-server/dist/index.js` from `node_modules` directly.
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
calls would go unlogged. This build fixes that in the hook:

- Log every `porkbun_write` call.
- Log `porkbun_read` calls whose input has `reveal: true`, because those return unmasked
  secrets such as the SSL private key. Other `porkbun_read` calls stay unlogged, like every
  other read tool.

That hook lives in the `~/.claude` control-plane git repo, not in infraops or
security-standards (`make install` doesn't deploy it), so the change is a separate commit
there. Check 13 raises one URGENT control-plane drift finding for that commit, which Devon
acknowledges as intentional. The logged arguments include `tool`, which records the Porkbun
operation.

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
about the gateway path. The existing rules already cover the known fields: the name rule
matches `secret` (webhooks) and `password` (mailbox, WordPress), and the PEM value-shape rule
catches the SSL bundle's `privatekey`, a field name the name rule misses. Name-based masking
only works because the gateway passes the child's JSON through unchanged, which is why that
requirement matters. Extend `src/utils/redaction.ts` only if a test exposes a miss. Tests
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
  `BWS_PORKBUN_SECRET_KEY_SECRET_ID`. Use the no-colon form `${VAR-uuid}`, so setting a
  variable to an empty string disables Porkbun (an unset variable still gets the default).
  A failed fetch leaves Porkbun disabled and logs a warning; it never exits.
- Add both UUIDs to `.bws-secrets.toml`.
- Add one `.cred-consumers.toml` entry for the key pair, because the two halves are issued
  and rotated together. No existing class fits, so add a `porkbun-api-key` class to
  `CLASS_POLICY` in `src/security-drift/cred-rotation.ts` with `maxAgeDays: 365` (matching
  the other provider API keys) and `executor: false` (manual lane). Without a class, the
  nightly scan raises `cred.unknown-class`.

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
  3. One reversible write on the account's only domain (as of 2026-10-29 the account holds
     one domain, with API Access on; `list_domains` returns its name): add a TXT record, read
     it back, delete it.
  4. `get_ssl_bundle` comes back masked, and with `reveal: true` unmasked.
  5. A purchase tool is refused by the gateway.
  6. Killing the child mid-session recovers on the next call.
  7. With both Porkbun secret ID variables set to empty strings, infraops starts normally
     with Porkbun disabled.
     Then remove the temporary server.
- **Installed packages.** This is the first runtime dependency that git doesn't deliver:
  `dist/` is tracked, `node_modules` isn't. Extend `.claude/hooks/session-sync.sh` so that
  when a fast-forward changes `package-lock.json`, it runs `npm ci` in the main
  checkout and then emits the `/mcp reconnect infraops` reminder. If `npm ci` fails, the hook
  reports the failure and still never blocks startup. Update the CLAUDE.md section on keeping
  `main` current, which says a merged change arrives through git alone.
- **Go-live.** Merge, `git sync` in the main checkout, `npm ci` (the hook covers
  later syncs, but not this first one if the sync happens outside a session start),
  `/mcp reconnect infraops`.

## Decided by Devon

- Build Porkbun support into infraops as a gateway to Porkbun's official server (option 2 of 3).
- Porkbun is an additional provider; Namecheap stays.
- The key can't spend money.
- Disruption to live infraops use and per-session weight both matter.
- The secrets go into BWS project Ops / Platform.
- Agents may turn auto-renew on and off (`update_auto_renew` stays allowed), even though
  auto-renew charges account credit at expiry.
- The session-sync hook runs `npm ci` when `package-lock.json` changes.

## Claude's calls (Devon can overrule)

- Three gateway tools with a read/write split, rather than two tools.
- Gateway-level denylist for spend tools, on top of the key's scopes. `cancel_transfer`,
  which the package calls money-adjacent, stays allowed: it refunds an order rather than
  charging one.
- Exact-version pin instead of `npx` or a caret range.
- Minimal child environment.
- Crash back-off of three failures in 60 seconds, then 5 minutes.
- The audit-hook change ships as part of this build, and covers `porkbun_read` only when
  `reveal` is true.
- One rotation entry for the key pair, class `porkbun-api-key`, 365 days, manual lane.
- Porkbun-specific gateway rather than a general one.

## Left to the builder

- Module layout (for example `src/services/porkbun-gateway.ts` and `src/tools/porkbun.ts`).
- The area mapping for `PORKBUN_TOOL_GROUPS`.
- How `porkbun_list_tools` formats output within the 25K character limit.
- Exact error wording.
