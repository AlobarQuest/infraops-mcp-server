# Porkbun gateway implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three infraops tools (`porkbun_list_tools`, `porkbun_read`, `porkbun_write`) that lazily start Porkbun's official MCP server as a child process and forward calls to it, under infraops redaction and audit.

**Architecture:** A pinned npm dependency (`@porkbunllc/mcp-server@0.54.0`) is started on first use through the MCP SDK `Client` + `StdioClientTransport`. A committed catalog classifies every child tool (denied, or allowed with an area). The three tools route by the child's `readOnlyHint` and return the child's content blocks unchanged, so the existing `installRedaction` wrapper parses and masks them.

**Tech Stack:** TypeScript, Node 18+, `@modelcontextprotocol/sdk` ^1.32.1, zod 4.6.7, vitest, bash.

**Spec:** `docs/superpowers/specs/2026-10-29-porkbun-gateway-design.md` (approved 2026-10-29). Read it before starting any task.

## Global constraints

- Work only in the worktree `/Users/devon/Projects/infraops-mcp-server-porkbun`, branch `feat/porkbun-gateway`. Never edit `/Users/devon/Projects/infraops-mcp-server` (the live checkout) before merge.
- `@porkbunllc/mcp-server` is pinned at exactly `0.54.0` (no caret). Never `npx`.
- Child entry point: `node_modules/@porkbunllc/mcp-server/dist/index.js`, run with `process.execPath`.
- The child's `env` is exactly `{ PORKBUN_API_KEY, PORKBUN_SECRET_API_KEY }`; the SDK adds `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`.
- Forwarded calls use `REQUEST_TIMEOUT` from `src/constants.ts` (30000 ms).
- Crash back-off: 3 start failures within 60 000 ms ⇒ refuse for 300 000 ms.
- Never wrap child results in `jsonResponse`; return `{ content, isError }` from the child as-is.
- Never add `porkbun_*` to `ALWAYS_BYPASS`.
- Every commit that changes `src/` also commits the rebuilt `dist/` (`npm run build && git add dist/`). CI fails otherwise.
- BWS secret UUIDs: `porkbun-api-key` = `27e165db-5d54-4176-94df-b4f201476bed` → `PORKBUN_API_KEY`; `porkbun-secret-key` = `28acc253-51e3-4ee1-8a04-b4f2014782fe` → `PORKBUN_SECRET_API_KEY`. Project Ops / Platform.
- Tests never call the live Porkbun API.
- Before declaring done: `make check` green, then `/code-review` on the branch diff.

## Review focus

1. **Concurrent first calls** (two agents' calls arriving before the child is up) must start exactly one child. Pinned in Task 2 (`starts one child for concurrent first calls`).
2. **Child dies between calls** (Porkbun process killed or crashes): the next call must start a fresh child, not hang on a dead transport. Pinned in Task 2 (`restarts after the child exits`).
3. **Child never comes up** (missing `node_modules` after a sync without `npm ci`): the error must name the fix (`npm ci --omit=dev`), and repeated calls must not spawn in a tight loop. Pinned in Task 2 (`names npm ci when the entry point is missing`, `backs off after three failed starts`).
4. **Wrong tool for the operation** (a write sent through `porkbun_read`, or an unknown or denied name): refusal names the right tool or the reason, and never reaches the child. Pinned in Task 3.
5. **Secret in a forwarded response** (SSL private key with escaped newlines, webhook `secret`): masked by default, visible with `reveal: true`. Pinned in Task 3 using the child's real text format.

---

### Task 1: Pin the package and commit the tool catalog

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/services/porkbun-catalog.ts`
- Test: `tests/porkbun-catalog.test.ts`

**Interfaces:**
- Produces (in `src/services/porkbun-catalog.ts`):
  - `export const PORKBUN_PACKAGE_VERSION = '0.54.0'`
  - `export type PorkbunArea = 'account' | 'cloudflare' | 'dns' | 'docs' | 'domains' | 'email' | 'hosting' | 'marketplace' | 'ssl' | 'webhooks'`
  - `export const DENIED_TOOLS: ReadonlySet<string>`: the 18 names in the spec's Denylist section.
  - `export const TOOL_AREAS: Readonly<Record<string, PorkbunArea>>`: every allowed tool name → its area.
  - `export function parseToolGroups(raw: string | undefined): ReadonlySet<PorkbunArea> | null`: `null` for unset or blank; otherwise the trimmed, lowercased comma-separated areas. Throws `Error` naming any unknown area.
  - `export function isExposed(name: string, groups: ReadonlySet<PorkbunArea> | null): boolean`: false if denied or unknown; true if `groups` is null; otherwise whether the tool's area is in `groups`.

- [ ] **Step 1: Install the pinned dependency**

Run: `npm install --save-exact @porkbunllc/mcp-server@0.54.0`
Expected: `package.json` lists `"@porkbunllc/mcp-server": "0.54.0"` under `dependencies`.

- [ ] **Step 2: Write the failing tests**

`tests/porkbun-catalog.test.ts`. The first test starts the installed package with no credentials (its `tools/list` works without them), using `Client` and `StdioClientTransport` from the SDK directly:

```ts
it('classifies every tool the pinned package serves, and nothing else', async () => {
  const names = await listInstalledToolNames(); // helper in the test file: connect, listTools, close
  const classified = new Set([...DENIED_TOOLS, ...Object.keys(TOOL_AREAS)]);
  expect(names.filter((n) => !classified.has(n))).toEqual([]); // unreviewed new tools
  expect([...classified].filter((n) => !names.includes(n))).toEqual([]); // stale entries
  expect(names).toHaveLength(120);
});
it('never both denies and allows a tool', () => {
  expect(Object.keys(TOOL_AREAS).filter((n) => DENIED_TOOLS.has(n))).toEqual([]);
});
it('denies every spend and sandbox tool', () => {
  for (const n of ['register_domain', 'renew_domain', 'transfer_domain', 'buy_closeout',
    'create_hosting', 'create_mailbox', 'renew_mailbox', 'top_up_account_credit',
    'configure_auto_topup', 'top_up_with_usdc', 'get_usdc_topup_status', 'top_up_with_card_mpp',
    'create_sandbox_key', 'sandbox_topup', 'sandbox_reset', 'sandbox_trigger_webhook',
    'request_api_key', 'retrieve_api_key'])
    expect(DENIED_TOOLS.has(n)).toBe(true);
});
it('keeps update_auto_renew and cancel_transfer allowed', () => {
  expect(TOOL_AREAS.update_auto_renew).toBe('domains');
  expect(TOOL_AREAS.cancel_transfer).toBe('domains');
});
it('parses tool groups', () => {
  expect(parseToolGroups(undefined)).toBeNull();
  expect(parseToolGroups('  ')).toBeNull();
  expect([...parseToolGroups(' DNS, domains ')!].sort()).toEqual(['dns', 'domains']);
  expect(() => parseToolGroups('dns,bogus')).toThrow(/bogus/);
});
it('exposes by group', () => {
  const dns = parseToolGroups('dns');
  expect(isExposed('list_domains', null)).toBe(true);
  expect(isExposed('register_domain', null)).toBe(false);
  expect(isExposed('no_such_tool', null)).toBe(false);
  expect(isExposed(dnsToolName, dns)).toBe(true);      // any tool you mapped to 'dns'
  expect(isExposed('list_domains', dns)).toBe(false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/porkbun-catalog.test.ts`
Expected: FAIL, module `src/services/porkbun-catalog.ts` not found.

- [ ] **Step 4: Write the catalog**

Get the tool list from the installed package (`listInstalledToolNames` output, or `node_modules/@porkbunllc/mcp-server/dist/tools.js`). Put the 18 spec denylist names (Sandbox, Top-ups, Purchases, API-key requests) in `DENIED_TOOLS`, and the remaining 102 in `TOOL_AREAS`. Map areas from the API spec's tags: Domain → `domains` (including glue, URL forwarding, contacts, transfers, auto-renew), Porkbun DNS and DNS → `dns` (including DNSSEC and restore points), SSL → `ssl`, Email → `email`, Hosting → `hosting`, Webhooks → `webhooks`, Cloudflare → `cloudflare`, Account and Pricing and Utility → `account`, Marketplace, Aftermarket, and Closeouts reads → `marketplace`, doc-search tools → `docs`. A one-line comment above `DENIED_TOOLS` names the source: `profiles.js` SANDBOX, TOPUPS, PURCHASES in 0.54.0, plus the API-key-request tools.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/porkbun-catalog.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Build and commit**

```bash
npm run build
git add package.json package-lock.json src/services/porkbun-catalog.ts tests/porkbun-catalog.test.ts dist/
git commit -m "feat(porkbun): pin the official server and classify its tools"
```

### Task 2: The lazy child-process gateway

**Files:**
- Create: `src/services/porkbun-gateway.ts`
- Create: `tests/fixtures/fake-porkbun-server.mjs`
- Test: `tests/porkbun-gateway.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (in `src/services/porkbun-gateway.ts`):
  - `export interface PorkbunToolInfo { name: string; description: string; readOnly: boolean; inputSchema: unknown }`. `readOnly` is `annotations?.readOnlyHint === true`.
  - `export interface PorkbunGatewayOptions { entryPath?: string; env?: Record<string, string>; timeoutMs?: number; now?: () => number }`. Defaults: the package's `dist/index.js` resolved from `node_modules`, the two `PORKBUN_*` variables from `process.env`, `REQUEST_TIMEOUT`, `Date.now`.
  - `export class PorkbunGateway { constructor(opts?: PorkbunGatewayOptions); listTools(): Promise<PorkbunToolInfo[]>; callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>; close(): Promise<void> }`
  - `export function isPorkbunConfigured(): boolean`: both `PORKBUN_API_KEY` and `PORKBUN_SECRET_API_KEY` are non-empty.
  - `export function getPorkbunGateway(): PorkbunGateway`: process-wide singleton. On first creation it registers handlers for `exit`, `SIGTERM`, and `SIGINT` that kill the child (re-raising the signal afterward so infraops still exits), so an infraops exit leaves no orphan.

- [ ] **Step 1: Write the fixture**

`tests/fixtures/fake-porkbun-server.mjs`: a stdio MCP server built with the SDK's `McpServer`. It serves three tools: `fake_read` (`readOnlyHint: true`, returns `{ content: [{ type: 'text', text: JSON.stringify({ env: <the two PORKBUN_* vars and whether COOLIFY_API_TOKEN is set>, pid: process.pid }, null, 2) }] }`), `fake_write` (`readOnlyHint: false`), and `fake_exit` (calls `process.exit(1)`). It writes one line to stderr at startup.

- [ ] **Step 2: Write the failing tests**

Each test builds `new PorkbunGateway({ entryPath: FIXTURE, env: { PORKBUN_API_KEY: 'pk', PORKBUN_SECRET_API_KEY: 'sk' } })` and closes it in `afterEach`.

```ts
it('does not start a child until first use', ...)            // spy on StdioClientTransport.prototype.start or count pids: no child before listTools()
it('lists tools with readOnly from annotations', async () => {
  const tools = await gw.listTools();
  expect(tools.find((t) => t.name === 'fake_read')!.readOnly).toBe(true);
  expect(tools.find((t) => t.name === 'fake_write')!.readOnly).toBe(false);
});
it('starts one child for concurrent first calls', async () => {
  const [a, b] = await Promise.all([gw.callTool('fake_read', {}), gw.callTool('fake_read', {})]);
  expect(pidOf(a)).toBe(pidOf(b));
});
it('passes only the Porkbun keys to the child', async () => {
  process.env.COOLIFY_API_TOKEN = 'must-not-leak';
  const body = JSON.parse(text(await gw.callTool('fake_read', {})));
  expect(body.env).toEqual({ PORKBUN_API_KEY: 'pk', PORKBUN_SECRET_API_KEY: 'sk', COOLIFY_API_TOKEN: false });
});
it('returns the child content blocks unchanged', async () => {
  const r = await gw.callTool('fake_read', {});
  expect(r.content[0].type).toBe('text');
  expect(() => JSON.parse(text(r))).not.toThrow(); // not double-encoded
});
it('restarts after the child exits', async () => {
  const first = pidOf(await gw.callTool('fake_read', {}));
  await expect(gw.callTool('fake_exit', {})).rejects.toThrow();
  expect(pidOf(await gw.callTool('fake_read', {}))).not.toBe(first);
});
it('names npm ci when the entry point is missing', async () => {
  const bad = new PorkbunGateway({ entryPath: '/nonexistent/index.js', env: {...} });
  await expect(bad.listTools()).rejects.toThrow(/npm ci --omit=dev/);
});
it('backs off after three failed starts', async () => {
  let t = 0;
  const bad = new PorkbunGateway({ entryPath: '/nonexistent/index.js', env: {...}, now: () => t });
  for (let i = 0; i < 3; i++) await expect(bad.listTools()).rejects.toThrow();
  await expect(bad.listTools()).rejects.toThrow(/retry after/i); // refused without spawning
  t = 300_001;
  await expect(bad.listTools()).rejects.toThrow(/npm ci/);       // tries again
});
it('forwards child stderr with a [porkbun] prefix', ...)          // spy on process.stderr.write
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/porkbun-gateway.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `src/services/porkbun-gateway.ts`**

Keep one `Promise<Client> | null`. Clear it in the transport's `onclose` and on a failed start. Check the entry path exists before spawning; when it doesn't, throw an error that says to run `npm ci --omit=dev` in the infraops checkout. Use `stderr: 'pipe'` and prefix each line with `[porkbun] ` on `process.stderr`. Record failure timestamps; when three fall within 60 000 ms, refuse with a message containing `retry after <ISO time>` until 300 000 ms have passed. Cache `listTools()` per child start. Pass `{ timeout: timeoutMs }` to `client.callTool`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/porkbun-gateway.test.ts`
Expected: PASS (9 tests), no child processes left afterward (`pgrep -f fake-porkbun-server` prints nothing).

- [ ] **Step 6: Build and commit**

```bash
npm run build
git add src/services/porkbun-gateway.ts tests/fixtures/fake-porkbun-server.mjs tests/porkbun-gateway.test.ts dist/
git commit -m "feat(porkbun): lazy gateway to the Porkbun MCP child process"
```

### Task 3: The three tools, routing, and redaction

**Files:**
- Create: `src/tools/porkbun.ts`
- Test: `tests/porkbun-tools.test.ts`

**Interfaces:**
- Consumes: `DENIED_TOOLS`, `isExposed`, `parseToolGroups` (Task 1); `PorkbunToolInfo`, `getPorkbunGateway` (Task 2).
- Produces: `export function registerPorkbunTools(server: McpServer, gateway?: Pick<PorkbunGateway, 'listTools' | 'callTool'>): void`. The `gateway` parameter defaults to `getPorkbunGateway()` and exists for tests. Groups come from `parseToolGroups(process.env.PORKBUN_TOOL_GROUPS)`, read once at registration.

Tool definitions:

| Tool | Input | Annotations |
|---|---|---|
| `porkbun_list_tools` | `name?: string` (substring filter), `include_schema?: boolean` (default false; true when `name` matches exactly one tool) | `readOnlyHint: true, openWorldHint: true` |
| `porkbun_read` | `tool: string`, `arguments: Record<string, unknown>` (default `{}`) | `readOnlyHint: true, openWorldHint: true` |
| `porkbun_write` | same | `readOnlyHint: false, destructiveHint: true, openWorldHint: true` |

`porkbun_list_tools` returns `jsonResponse` of `{ tools: [{ name, description, access: 'read' | 'write', area, inputSchema? }] }`, filtered by `isExposed`.

- [ ] **Step 1: Write the failing tests**

Use the `fakeServer()` + `installRedaction` pattern from `tests/register-sanitized.test.ts`, and a stub gateway whose `listTools` returns `get_ssl_bundle` (read), `list_domains` (read), `create_dns_record` (write), `register_domain` (write), and whose `callTool` records calls and returns canned results in the child's real format: `{ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] }`.

```ts
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----';
it('registers exactly three tools', () => expect(Object.keys(s.handlers).sort())
  .toEqual(['porkbun_list_tools', 'porkbun_read', 'porkbun_write']));
it('marks porkbun_read read-only and porkbun_write not', ...)
it('routes a read tool through porkbun_read', ...)               // stub.callTool called with ('list_domains', {})
it('refuses a write tool through porkbun_read and names porkbun_write', async () => {
  const r = await s.handlers.porkbun_read({ tool: 'create_dns_record', arguments: {} }, {});
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toMatch(/porkbun_write/);
  expect(stub.calls).toEqual([]);
});
it('refuses a read tool through porkbun_write and names porkbun_read', ...)
it('refuses a denied tool in both and never lists it', ...)      // register_domain
it('refuses an unknown tool name', ...)
it('honours PORKBUN_TOOL_GROUPS', ...)                           // 'dns' hides list_domains from list and calls
it('masks the SSL private key by default', async () => {
  stub.result = childText({ status: 'SUCCESS', certificatechain: 'x', privatekey: PEM, publickey: 'y' });
  const r = await s.handlers.porkbun_read({ tool: 'get_ssl_bundle', arguments: { domain: 'd.com' } }, {});
  expect(r.content[0].text).not.toContain('BEGIN PRIVATE KEY');
});
it('reveals the SSL private key with reveal:true', ...)          // text contains 'BEGIN PRIVATE KEY'
it('masks a webhook secret by field name', ...)                  // { webhook: { id: 1, secret: 'whsec_abc' } } → no 'whsec_abc'
it('passes isError from the child through', ...)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/porkbun-tools.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `registerPorkbunTools` in `src/tools/porkbun.ts`**

Follow the structure of `src/tools/github.ts`. Both call tools share one handler factory parameterized by the expected access. Refusals return `{ isError: true, content: [{ type: 'text', text }] }` without calling the gateway. Gateway errors become the same `isError` shape with the error message. If a test exposes a redaction miss, extend `src/utils/redaction.ts` and add the case to `tests/redaction.test.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/porkbun-tools.test.ts tests/redaction.test.ts tests/register-sanitized.test.ts`
Expected: PASS.

- [ ] **Step 5: Build and commit**

```bash
npm run build
git add src/tools/porkbun.ts tests/porkbun-tools.test.ts dist/   # plus redaction files if changed
git commit -m "feat(porkbun): porkbun_list_tools, porkbun_read, porkbun_write"
```

### Task 4: Wire it in, fetch the secrets, register the credential, document it

**Files:**
- Modify: `src/index.ts` (header comment, imports, a Porkbun block after Namecheap's)
- Modify: `start.sh` (a Porkbun block after Namecheap's; header comment)
- Modify: `.bws-secrets.toml`, `.cred-consumers.toml`
- Modify: `src/security-drift/cred-rotation.ts` (`CLASS_POLICY`)
- Modify: `CLAUDE.md`, `RUNBOOK.md`
- Test: `tests/cred-rotation.test.ts`, `tests/start-porkbun.test.sh`

**Interfaces:**
- Consumes: `registerPorkbunTools` (Task 3), `isPorkbunConfigured` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `tests/cred-rotation.test.ts`, add `'porkbun-api-key'` to the class lists at lines 501 and 593 (next to `'anthropic-api-key'`), and:

```ts
it('treats porkbun-api-key as a manual-lane 365-day class', () => {
  expect(CLASS_POLICY['porkbun-api-key']).toMatchObject({ maxAgeDays: 365, executor: false });
});
```

`tests/start-porkbun.test.sh`, in the style of `tests/change-window.test.sh` (stub `bws` and `node` on `PATH`, temporary `HOME`, stub `security` returning a placeholder token, nothing live). Checks:
- `ok   default UUIDs`: with no `BWS_PORKBUN_*` variables, the stub `node` sees `PORKBUN_API_KEY=value-of-27e165db-5d54-4176-94df-b4f201476bed` and `PORKBUN_SECRET_API_KEY=value-of-28acc253-51e3-4ee1-8a04-b4f2014782fe`.
- `ok   empty disables`: with both `BWS_PORKBUN_*_SECRET_ID=""`, `node` sees both variables empty and the script still execs `node`.
- `ok   fetch failure does not exit`: with `bws` exiting 1, the script still execs `node`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/cred-rotation.test.ts && bash tests/start-porkbun.test.sh`
Expected: the new vitest case fails and the shell test prints `FAIL` lines.

- [ ] **Step 3: Implement**

- `CLASS_POLICY`: `'porkbun-api-key': { maxAgeDays: 365, executor: false, landmines: [] }`.
- `start.sh`: fetch with `fetch_bws_secret "${BWS_PORKBUN_API_KEY_SECRET_ID-27e165db-5d54-4176-94df-b4f201476bed}"` (no colon) and the same for the secret key; log "Porkbun tools enabled" only when both are non-empty; never exit.
- `src/index.ts`: after the Namecheap block, `if (isPorkbunConfigured()) { try { registerPorkbunTools(server); console.error('Porkbun gateway tools registered'); } catch (err) { console.error('Porkbun tools disabled:', err); } } else { console.error('PORKBUN_API_KEY/SECRET_API_KEY not set — Porkbun tools disabled'); }`. Add the two variables and `PORKBUN_TOOL_GROUPS` to the header comment.
- `.bws-secrets.toml`: two `[[secret]]` entries with `project = "Ops / Platform"` and the BWS names `porkbun-api-key` and `porkbun-secret-key`.
- `.cred-consumers.toml`: one `[[credential]]` with `id = "porkbun-api-keypair"`, `class = "porkbun-api-key"`, `provider = "porkbun"`, `bws_uuid` = the API key's UUID, and consumers: two `bws-secret` entries (both UUIDs) and a `runtime-fetch` entry (`repo = "infraops-mcp-server"`, `ref = "start.sh"`). Compute `fingerprint_sha256_8` and the `consumers_verified` attestation with `scripts/cred-consumer-sweep.py`; it prints hash prefixes only. Add `porkbun-api-keypair` wherever the cred-registry integration test enumerates registered ids.
- `CLAUDE.md`: Porkbun row in the provider table, `porkbun-catalog.ts`, `porkbun-gateway.ts`, and `porkbun.ts` in the architecture tree, tool count (~216 tools across 8 providers), and a short "Porkbun gateway" paragraph that states the lazy child, the pinned version, and that upgrading is a PR that also updates the catalog. In the "keep `main` current" section, replace "via git alone" with the `npm ci` caveat from Task 5.
- `RUNBOOK.md`: provider section (secrets, `PORKBUN_TOOL_GROUPS`, how to upgrade the pin), secret IDs, and troubleshooting for `API_ACCESS_DISABLED`, `INSUFFICIENT_SCOPE`, `DOMAIN_NOT_ALLOWED`, and a missing `node_modules`.

- [ ] **Step 4: Run the full gate**

Run: `bash tests/start-porkbun.test.sh && make check`
Expected: three `ok` lines; `make check` exits 0 with a collected-test count that includes the new files.

- [ ] **Step 5: Build and commit**

```bash
npm run build
git add -A src/ dist/ start.sh .bws-secrets.toml .cred-consumers.toml CLAUDE.md RUNBOOK.md tests/
git commit -m "feat(porkbun): register the gateway, fetch keys from BWS, add rotation class"
```

### Task 5: Session-sync hook runs `npm ci` on lockfile changes

**Files:**
- Modify: `.claude/hooks/session-sync.sh`
- Test: `tests/session-sync.test.sh`

- [ ] **Step 1: Write the failing test**

`tests/session-sync.test.sh` builds a scratch origin and clone under `mktemp -d`, copies the hook into the clone's `.claude/hooks/`, puts a stub `npm` on `PATH` that records its arguments (or exits 1 when `NPM_FAIL=1`), and runs the hook. Checks:
- `ok   lockfile change runs npm ci`: a pushed commit changing `package-lock.json` ⇒ stub saw `ci --omit=dev`; output JSON mentions `npm ci` and `/mcp reconnect infraops`.
- `ok   no lockfile change skips npm`: a commit changing only `README.md` ⇒ stub never called.
- `ok   npm failure still exits 0`: `NPM_FAIL=1` ⇒ hook exits 0 and the output names the failure and the manual command.

- [ ] **Step 2: Run it to verify it fails**

Run: `bash tests/session-sync.test.sh`
Expected: `FAIL   lockfile change runs npm ci`.

- [ ] **Step 3: Implement**

After a successful fast-forward, if `git diff --quiet "$before" HEAD -- package-lock.json` fails, run `npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1`. Fold the result into the emitted message, together with the existing `dist/` reminder. Update the header comment, which says to run `npm run build` after a sync, to describe the `npm ci` step.

- [ ] **Step 4: Run it to verify it passes**

Run: `bash tests/session-sync.test.sh && shellcheck .claude/hooks/session-sync.sh tests/session-sync.test.sh`
Expected: three `ok` lines; shellcheck prints nothing.

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/session-sync.sh tests/session-sync.test.sh
git commit -m "feat(session-sync): run npm ci when package-lock.json changes"
```

### Task 6: Audit and gate `porkbun_write` in the control plane (`~/.claude` repo)

This task commits in `/Users/devon/.claude`, a different repo. Commit directly there (that repo's convention). Stage only the two hook files; leave the untracked `skills/synced/` alone.

**Files:**
- Modify: `/Users/devon/.claude/hooks/high-power-audit-log.sh`
- Modify: `/Users/devon/.claude/hooks/high-power-gate.sh`

- [ ] **Step 1: Write the failing checks**

Pipe hook input JSON into each hook with a temporary `HOME` (so the audit log lands in scratch), for example `{"tool_name":"mcp__infraops__porkbun_write","tool_input":{"tool":"create_dns_record","arguments":{}}}`. Expected after the change:
- Audit hook: logs `porkbun_write`; logs `porkbun_read` when `tool_input.reveal` is `true`; does not log `porkbun_read` without it; does not log `porkbun_list_tools`.
- Gate hook: `porkbun_write` ⇒ `permissionDecision: "ask"` (parity with Namecheap mutators); `porkbun_read` and `porkbun_list_tools` ⇒ no output.

Run the checks against the current hooks; expected: the `porkbun_write` cases fail.

- [ ] **Step 2: Implement**

Audit hook: add `porkbun_write` to `GATED`. After the `GATED` check fails, add a second condition that records the call when the tool name matches `porkbun_read` and `.tool_input.reveal == true`. Gate hook: add `*porkbun_write*` to the infrastructure-mutation `case` arm.

- [ ] **Step 3: Re-run the checks**

Expected: every case behaves as listed in Step 1. `shellcheck` on both hooks prints nothing new.

- [ ] **Step 4: Commit in the control-plane repo**

```bash
git -C /Users/devon/.claude add hooks/high-power-audit-log.sh hooks/high-power-gate.sh
git -C /Users/devon/.claude commit -m "hooks: audit and gate porkbun_write; audit porkbun_read with reveal"
```

The next 3am drift run raises one URGENT Check 13 finding for this commit; Devon acknowledges it as intentional.

### Task 7: Live verification, review, and go-live

- [ ] **Step 1: Code review**

Run `make check`, then `/code-review` on the branch diff against `main`. Fix findings, rebuild `dist/`, and commit.

- [ ] **Step 2: Register the worktree as a temporary MCP server**

Run: `claude mcp add infraops-porkbun-test --scope user -- bash /Users/devon/Projects/infraops-mcp-server-porkbun/start.sh` with the same env variables as the `infraops` entry in `~/.claude.json`. Start a fresh session for the checks.

- [ ] **Step 3: Run the spec's seven live checks** through `mcp__infraops-porkbun-test__*`:

1. `porkbun_list_tools` returns tools; `pgrep -fl porkbunllc` shows exactly one child.
2. `porkbun_read` `ping`: succeeds; `scopes` contains neither `purchase` nor `funding`.
3. `porkbun_read` `list_domains` gives the domain; `porkbun_write` creates TXT `_infraops-test` with content `porkbun-gateway-check`; `porkbun_read` reads it back; `porkbun_write` deletes it; a final read confirms it's gone.
4. `porkbun_read` `get_ssl_bundle` is masked; with `reveal: true` it shows the PEM (don't echo it in chat beyond confirming its header line).
5. `porkbun_write` `register_domain` is refused by the gateway.
6. `pkill -f porkbunllc`, then `porkbun_read` `ping` succeeds with a new child.
7. Start once with `BWS_PORKBUN_API_KEY_SECRET_ID=""`: stderr shows `Porkbun tools disabled` and other providers register.

Then run `claude mcp remove infraops-porkbun-test --scope user`.

- [ ] **Step 4: Open the PR**

Push `feat/porkbun-gateway` and open a PR whose body lists the seven live results. Merge only with Devon's go-ahead.

- [ ] **Step 5: Go live in the main checkout**

`git sync`, then `npm ci --omit=dev`, then `/mcp reconnect infraops`. Confirm `porkbun_read` `ping` works through `mcp__infraops__porkbun_read`. Remove the worktree with `git worktree remove ../infraops-mcp-server-porkbun`.
