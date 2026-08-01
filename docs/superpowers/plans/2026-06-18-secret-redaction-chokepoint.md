# Secret-Redaction Chokepoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redact secrets from every MCP tool response by default, via a single chokepoint that patches `server.registerTool` once, with an audited `reveal` opt-out and an always-bypass registry for value-read tools.

**Architecture:** A pure `redaction.ts` (name-based + value-shape rules, Balanced posture) is applied by a `register-sanitized.ts` wrapper that patches `registerTool` in `index.ts` — injecting an optional `reveal` into each tool's schema and routing each handler result through redact-then-truncate. `jsonResponse` is reduced to serialize-only; the wrapper owns truncation so redaction always precedes it.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (`McpServer.registerTool`), Zod, vitest.

## Global Constraints

- **Balanced posture:** precise secret-name patterns + value-shape patterns; anchored guards keep `public_key`, `key_name`, `*_id`, `*_uuid`, `*_url`, `*_fingerprint`, `*_name`, `*_at`, and ssh public material visible.
- **Redact before truncate:** redaction runs on parsed structure; truncation happens after, in the wrapper. A secret must never be split across the truncation boundary.
- **3-tier opt-out:** default sanitize; `args.reveal === true` bypasses redaction (not truncation); `ALWAYS_BYPASS` tool names bypass redaction unconditionally.
- **`ALWAYS_BYPASS` = exactly:** `vps_read_file`, `vps_exec`, `vps_docker_logs`, `cloudflare_get_kv_value`, `cloudflare_query_d1`, `namecheap_domains_get_contacts`.
- **Kill switch:** `process.env.INFRAOPS_DISABLE_REDACTION === "1"` disables redaction (truncation still applies).
- **Reveal injection:** inject `reveal` into a tool's `inputSchema` only if it does not already declare `reveal`.
- **Sanitize error responses too** (an error can echo a secret), subject to the same bypass rules.
- **Defense-in-depth:** do NOT remove existing `masking.ts` / `env-vars.ts` / `private-keys.ts` masking. The central layer is a superset backstop.
- **`dist/` is TRACKED** (the server + CLIs run from it): every task that changes `src/` MUST `npm run build` and `git add dist/` in the same commit. Vitest runs `src/`, so green tests do not prove `dist/` is current.
- **Redacted marker:** masked values become the string `"***"`. `null`/absent values are preserved (convey "no secret set").
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File structure

| File                                     | Responsibility                                                      |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `src/utils/redaction.ts` (new)           | Pure redaction: `isSecretName`, `redactText`, `deepRedact`. No I/O. |
| `tests/redaction.test.ts` (new)          | Unit tests for the rules.                                           |
| `src/utils/response.ts` (modify)         | Add `truncateToLimit`; `jsonResponse` serialize-only.               |
| `tests/response-util.test.ts` (modify)   | Reflect the serialize-only `jsonResponse` + new `truncateToLimit`.  |
| `src/utils/register-sanitized.ts` (new)  | `ALWAYS_BYPASS`, `installRedaction(server)` — the chokepoint.       |
| `tests/register-sanitized.test.ts` (new) | Wrapper behavior with a fake server.                                |
| `src/index.ts` (modify)                  | Call `installRedaction(server)` after server creation.              |
| `CLAUDE.md` (modify)                     | Document the chokepoint, reveal, kill switch, bypass list.          |

---

### Task 1: Pure redaction module (`redaction.ts`)

**Files:**

- Create: `src/utils/redaction.ts`
- Test: `tests/redaction.test.ts`

**Interfaces:**

- Produces:
  - `isSecretName(key: string): boolean`
  - `redactText(s: string): string` — value-shape redaction on a raw string
  - `deepRedact(value: unknown): unknown` — recursive, non-mutating; masks secret-named fields and value-shapes; preserves `null`

- [ ] **Step 1: Write the failing tests**

Create `tests/redaction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isSecretName, redactText, deepRedact } from '../src/utils/redaction.js';

const PEM =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----';

describe('isSecretName', () => {
  it('flags secret-bearing names', () => {
    for (const k of [
      'private_key',
      'postgres_password',
      'redis_password',
      'root_password',
      'manual_webhook_secret_github',
      'http_basic_auth_password',
      'client_secret',
      'tunnel_secret',
      'jwt_secret',
      'credentials',
      'access_token',
    ]) {
      expect(isSecretName(k)).toBe(true);
    }
  });
  it('preserves guarded / non-secret names', () => {
    for (const k of [
      'public_key',
      'key_name',
      'private_key_id',
      'private_key_uuid',
      'application_id',
      'deployment_uuid',
      'fingerprint',
      'database_url',
      'created_at',
      'application_name',
      'status',
      'commit',
      'port',
      'region',
    ]) {
      expect(isSecretName(k)).toBe(false);
    }
  });
});

describe('redactText (value-shape)', () => {
  it('redacts a PEM private key block', () => {
    expect(redactText(`key is ${PEM} end`)).not.toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(redactText(`key is ${PEM} end`)).toContain('***');
  });
  it('redacts a truncated PEM head (no END)', () => {
    const head = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA';
    expect(redactText(head)).not.toContain('MIIEpAIBAAKCAQEA');
  });
  it('redacts a JWT (Supabase service_role shape)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiI.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abc-_123';
    expect(redactText(`token=${jwt}`)).not.toContain(jwt);
  });
  it('redacts known token prefixes', () => {
    expect(redactText('ghp_0123456789abcdef0123456789abcdef0123')).toContain('***');
    expect(redactText('sk-ant-api03-abcdefghijklmnopqrstuvwx')).toContain('***');
  });
  it('redacts only the password in a connection URL', () => {
    const out = redactText('postgres://app:s3cr3tPw@db-host:5432/mydb');
    expect(out).toContain('postgres://app:***@db-host:5432/mydb');
    expect(out).not.toContain('s3cr3tPw');
  });
  it('leaves ssh public keys and ordinary text alone', () => {
    const pub = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID example@host';
    expect(redactText(pub)).toBe(pub);
    expect(redactText('just a normal sentence with an id 12345')).toBe(
      'just a normal sentence with an id 12345',
    );
  });
});

describe('deepRedact', () => {
  it('masks secret-named fields, preserves null and guarded fields', () => {
    const out: any = deepRedact({
      private_key: PEM,
      private_key_id: 7,
      public_key: 'ssh-ed25519 AAAA...',
      postgres_password: 'p4ss',
      manual_webhook_secret_github: 'whsec',
      no_secret_here: null,
      status: 'finished',
      application_name: 'booking',
    });
    expect(out.private_key).toBe('***');
    expect(out.postgres_password).toBe('***');
    expect(out.manual_webhook_secret_github).toBe('***');
    expect(out.private_key_id).toBe(7);
    expect(out.public_key).toBe('ssh-ed25519 AAAA...');
    expect(out.no_secret_here).toBeNull();
    expect(out.status).toBe('finished');
    expect(out.application_name).toBe('booking');
  });
  it('recurses nested objects and arrays (eager-loaded relations)', () => {
    const out: any = deepRedact({
      application: { source: { private_key: PEM } },
      rows: [{ db_password: 'x' }],
    });
    expect(out.application.source.private_key).toBe('***');
    expect(out.rows[0].db_password).toBe('***');
  });
  it('value-shape redacts a secret in a non-secret-named string field', () => {
    const out: any = deepRedact({ note: `cloned with ${PEM}`, api_key: 'eyJhbGciOi.eyJ.sig-_1' });
    expect(out.note).not.toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(out.api_key).toBe('***');
  });
  it('is non-mutating', () => {
    const input = { private_key: 'x' };
    deepRedact(input);
    expect(input.private_key).toBe('x');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/redaction.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/redaction.js'`.

- [ ] **Step 3: Implement `src/utils/redaction.ts`**

```ts
/**
 * Pure secret redaction (Balanced posture). No I/O. Applied centrally by
 * register-sanitized.ts to every tool response. Masks to "***"; preserves null.
 */

const MASK = '***';

// Field names whose VALUE is a secret. Checked only after the guard below.
const SECRET_NAME =
  /(password|secret|token|credentials|private_key|service_role|jwt_secret|tunnel_secret)/i;

// Names that look secret-ish but are not — never redact by name (value-shape may still apply).
const GUARD_NAME =
  /(?:^|_)(id|uuid|name|fingerprint|url|at|count|type|status|version|region|host|port)$|^public_key$|_key_name$|^key_name$/i;

export function isSecretName(key: string): boolean {
  if (GUARD_NAME.test(key)) return false;
  return SECRET_NAME.test(key);
}

// Value shapes redacted regardless of field name.
const VALUE_SHAPES: RegExp[] = [
  // PEM private key — to matching END or end-of-string (truncation-safe).
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|$)/g,
  // JWT (starts eyJ — base64 of `{"`). Catches Supabase anon/service_role keys.
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // GitHub tokens.
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // OpenAI / Anthropic.
  /\bsk-(?:ant-)?[A-Za-z0-9-]{20,}\b/g,
];

// Connection-string password: keep scheme/user/host, mask the password segment only.
const CONN_PW = /\b([a-z][a-z0-9+.-]*:\/\/[^:@/\s]+:)([^@/\s]+)(@)/gi;

export function redactText(s: string): string {
  let out = s;
  for (const re of VALUE_SHAPES) out = out.replace(re, MASK);
  out = out.replace(CONN_PW, `$1${MASK}$3`);
  return out;
}

export function deepRedact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null && v !== undefined && isSecretName(k)) out[k] = MASK;
      else out[k] = deepRedact(v);
    }
    return out;
  }
  return value;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/redaction.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/utils/redaction.ts tests/redaction.test.ts dist/
git commit -m "feat(redaction): pure secret redactor (name + value-shape, Balanced)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `jsonResponse` serialize-only + `truncateToLimit`

**Files:**

- Modify: `src/utils/response.ts`
- Test: `tests/response-util.test.ts`

**Interfaces:**

- Produces: `truncateToLimit(text: string, charLimit?: number): string` (exported). `jsonResponse(data, opts?)` no longer truncates — truncation moves to the wrapper (Task 3), guaranteeing redact-before-truncate.
- Consumes: `CHARACTER_LIMIT` from `constants.js`.

- [ ] **Step 1: Write the failing test**

Edit `tests/response-util.test.ts` — replace any assertion that `jsonResponse` truncates with these (keep other existing tests intact):

```ts
import { jsonResponse, truncateToLimit } from '../src/utils/response.js';
import { CHARACTER_LIMIT } from '../src/constants.js';

it('jsonResponse serializes without truncating (wrapper owns truncation now)', () => {
  const big = { blob: 'x'.repeat(CHARACTER_LIMIT + 5000) };
  const r = jsonResponse(big);
  expect(r.content[0].text.length).toBeGreaterThan(CHARACTER_LIMIT);
  expect(r.content[0].text).not.toContain('truncated:');
});

it('truncateToLimit truncates with an explicit marker', () => {
  const t = truncateToLimit('y'.repeat(CHARACTER_LIMIT + 5000));
  expect(t.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
  expect(t).toContain('truncated:');
});

it('truncateToLimit leaves short text unchanged', () => {
  expect(truncateToLimit('short')).toBe('short');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/response-util.test.ts`
Expected: FAIL — `truncateToLimit` is not exported / `jsonResponse` still truncates.

- [ ] **Step 3: Edit `src/utils/response.ts`**

Replace the `jsonResponse` function (lines 25-40) with:

```ts
/** Truncate text to `charLimit` with an explicit narrowing marker. */
export function truncateToLimit(text: string, charLimit: number = CHARACTER_LIMIT): string {
  if (text.length <= charLimit) return text;
  const keep = Math.max(0, charLimit - 220);
  const kb = Math.round(charLimit / 1000);
  return (
    text.slice(0, keep) +
    `\n…[truncated: response exceeded ${kb}K chars — narrow it with summary:true, ` +
    `pagination (page/per_page), or a more specific UUID/query]…`
  );
}

/**
 * Build a JSON tool response. Serialize-only — truncation is applied centrally by
 * the redaction wrapper (register-sanitized.ts) AFTER redaction, so a secret can
 * never be split across the truncation boundary.
 */
export function jsonResponse(data: unknown, _opts: { charLimit?: number } = {}): ToolTextResponse {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/response-util.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/utils/response.ts tests/response-util.test.ts dist/
git commit -m "refactor(response): jsonResponse serialize-only; add truncateToLimit

Truncation moves to the redaction wrapper so redaction precedes truncation.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The chokepoint wrapper (`register-sanitized.ts`)

**Files:**

- Create: `src/utils/register-sanitized.ts`
- Test: `tests/register-sanitized.test.ts`

**Interfaces:**

- Consumes: `deepRedact`, `redactText` (Task 1); `truncateToLimit` (Task 2).
- Produces: `installRedaction(server: { registerTool: Function }): void` — patches `server.registerTool` in place. `ALWAYS_BYPASS: Set<string>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/register-sanitized.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installRedaction, ALWAYS_BYPASS } from '../src/utils/register-sanitized.js';

const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nzzz\n-----END OPENSSH PRIVATE KEY-----';

// Minimal fake McpServer capturing registered handlers.
function fakeServer() {
  const handlers: Record<string, Function> = {};
  const configs: Record<string, any> = {};
  return {
    registerTool(name: string, config: any, cb: Function) {
      configs[name] = config;
      handlers[name] = cb;
    },
    handlers,
    configs,
  };
}

const secretResult = () => ({
  content: [{ type: 'text', text: JSON.stringify({ private_key: PEM, status: 'ok' }) }],
});

describe('installRedaction', () => {
  afterEach(() => {
    delete process.env.INFRAOPS_DISABLE_REDACTION;
  });

  it("redacts a tool's secret output by default", async () => {
    const s = fakeServer();
    installRedaction(s as any);
    s.registerTool('coolify_get_deployment', { inputSchema: {} }, async () => secretResult());
    const r = await s.handlers['coolify_get_deployment']({}, {});
    expect(r.content[0].text).toContain('***');
    expect(r.content[0].text).not.toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(r.content[0].text).toContain('ok');
  });

  it('bypasses redaction when reveal:true', async () => {
    const s = fakeServer();
    installRedaction(s as any);
    s.registerTool('coolify_get_deployment', { inputSchema: {} }, async () => secretResult());
    const r = await s.handlers['coolify_get_deployment']({ reveal: true }, {});
    expect(r.content[0].text).toContain('BEGIN OPENSSH PRIVATE KEY');
  });

  it('bypasses redaction for ALWAYS_BYPASS tools', async () => {
    const s = fakeServer();
    installRedaction(s as any);
    s.registerTool('vps_read_file', { inputSchema: {} }, async () => secretResult());
    const r = await s.handlers['vps_read_file']({}, {});
    expect(r.content[0].text).toContain('BEGIN OPENSSH PRIVATE KEY');
  });

  it('kill switch disables redaction', async () => {
    process.env.INFRAOPS_DISABLE_REDACTION = '1';
    const s = fakeServer();
    installRedaction(s as any);
    s.registerTool('coolify_get_deployment', { inputSchema: {} }, async () => secretResult());
    const r = await s.handlers['coolify_get_deployment']({}, {});
    expect(r.content[0].text).toContain('BEGIN OPENSSH PRIVATE KEY');
  });

  it('injects reveal into schema only when absent', async () => {
    const s = fakeServer();
    installRedaction(s as any);
    const existing = { reveal: { _tag: 'preexisting' } };
    s.registerTool('has_reveal', { inputSchema: existing }, async () => secretResult());
    s.registerTool('no_reveal', { inputSchema: {} }, async () => secretResult());
    expect((s.configs['has_reveal'].inputSchema.reveal as any)._tag).toBe('preexisting');
    expect(s.configs['no_reveal'].inputSchema.reveal).toBeDefined();
  });

  it('redacts error responses too', async () => {
    const s = fakeServer();
    installRedaction(s as any);
    s.registerTool('coolify_get_deployment', { inputSchema: {} }, async () => ({
      isError: true,
      content: [{ type: 'text', text: `failed: ${PEM}` }],
    }));
    const r = await s.handlers['coolify_get_deployment']({}, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).not.toContain('BEGIN OPENSSH PRIVATE KEY');
  });

  it('ALWAYS_BYPASS holds the value-read tools', () => {
    for (const t of [
      'vps_read_file',
      'vps_exec',
      'vps_docker_logs',
      'cloudflare_get_kv_value',
      'cloudflare_query_d1',
      'namecheap_domains_get_contacts',
    ])
      expect(ALWAYS_BYPASS.has(t)).toBe(true);
  });

  it('does NOT truncate ALWAYS_BYPASS output (value-reads stay whole), but truncates others', async () => {
    const s = fakeServer();
    installRedaction(s as any);
    const big = 'z'.repeat(40000);
    s.registerTool('vps_read_file', { inputSchema: {} }, async () => ({
      content: [{ type: 'text', text: big }],
    }));
    s.registerTool('coolify_get_application', { inputSchema: {} }, async () => ({
      content: [{ type: 'text', text: JSON.stringify({ blob: big }) }],
    }));
    const raw = await s.handlers['vps_read_file']({}, {});
    const cut = await s.handlers['coolify_get_application']({}, {});
    expect(raw.content[0].text.length).toBe(40000);
    expect(cut.content[0].text).toContain('truncated:');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/register-sanitized.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/utils/register-sanitized.ts`**

```ts
/**
 * Central secret-redaction chokepoint. `installRedaction(server)` patches
 * `server.registerTool` once so every tool (current + future) has:
 *   - an optional `reveal` injected into its input schema (only if absent), and
 *   - its handler result routed through redact-then-truncate.
 * 3-tier opt-out: default redact / `reveal:true` bypass / ALWAYS_BYPASS bypass.
 * Kill switch: INFRAOPS_DISABLE_REDACTION=1. Existing local masks remain as
 * defense-in-depth; this is the superset backstop.
 */
import { z } from 'zod';
import { deepRedact, redactText } from './redaction.js';
import { truncateToLimit } from './response.js';

/** Value-read tools whose output IS the requested content — never redacted. */
export const ALWAYS_BYPASS = new Set<string>([
  'vps_read_file',
  'vps_exec',
  'vps_docker_logs',
  'cloudflare_get_kv_value',
  'cloudflare_query_d1',
  'namecheap_domains_get_contacts',
]);

const REVEAL_FIELD = z
  .boolean()
  .default(false)
  .describe('Reveal redacted secret values in the response (default false; the call is audited)');

/** Redact one text blob: structured if JSON-parseable, else value-shape on the raw string. */
function redactTextContent(text: string): string {
  try {
    return JSON.stringify(deepRedact(JSON.parse(text)), null, 2);
  } catch {
    return redactText(text);
  }
}

function sanitizeResult(result: any, name: string, args: any): any {
  // ALWAYS_BYPASS tools return raw content the caller asked for — bypass BOTH
  // redaction AND truncation (they were unbounded before; truncating would cut
  // large file/query reads). All other tools: redact (unless reveal/kill-switch)
  // and always truncate for context-size safety.
  const isValueRead = ALWAYS_BYPASS.has(name);
  const bypassRedact =
    isValueRead || process.env.INFRAOPS_DISABLE_REDACTION === '1' || args?.reveal === true;
  if (!result || !Array.isArray(result.content)) return result;
  const content = result.content.map((item: any) => {
    if (item?.type !== 'text' || typeof item.text !== 'string') return item;
    const redacted = bypassRedact ? item.text : redactTextContent(item.text);
    return { ...item, text: isValueRead ? redacted : truncateToLimit(redacted) };
  });
  return { ...result, content };
}

export function installRedaction(server: { registerTool: (...a: any[]) => any }): void {
  const orig = server.registerTool.bind(server);
  server.registerTool = (name: string, config: any, cb: (args: any, extra: any) => any) => {
    const cfg = config ?? {};
    if (!cfg.inputSchema) cfg.inputSchema = {};
    if (!('reveal' in cfg.inputSchema)) cfg.inputSchema.reveal = REVEAL_FIELD;
    const wrapped = async (args: any, extra: any) => {
      const result = await cb(args, extra);
      return sanitizeResult(result, name, args);
    };
    return orig(name, cfg, wrapped);
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/register-sanitized.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/utils/register-sanitized.ts tests/register-sanitized.test.ts dist/
git commit -m "feat(redaction): registerTool chokepoint wrapper (reveal inject + redact/truncate)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire into the server + docs + end-to-end verify

**Files:**

- Modify: `src/index.ts`
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: `installRedaction` (Task 3).

- [ ] **Step 1: Wire the patch into `index.ts`**

In `src/index.ts`, immediately AFTER the server is created (the `const server = new McpServer({ … });` block, around line 93-96) and BEFORE the first `registerProjectTools(server);` call, add:

```ts
import { installRedaction } from './utils/register-sanitized.js';
// (place the import with the other top-of-file imports)

// Patch registerTool BEFORE any tool registers, so every tool is covered.
installRedaction(server);
```

(The `installRedaction(server);` call goes right after the `new McpServer` block; the `import` goes in the import section.)

- [ ] **Step 2: Build, full suite, and an end-to-end smoke check**

```bash
npm run build
npx vitest run
```

Expected: build clean; full suite passes (existing + the new redaction/wrapper/response tests).

Then a runtime smoke check that the wired server redacts (no live Coolify needed):

```bash
node -e '
const { installRedaction } = require("./dist/utils/register-sanitized.js");
const handlers = {};
const server = { registerTool: (n, c, cb) => { handlers[n] = cb; } };
installRedaction(server);
server.registerTool("coolify_get_deployment", { inputSchema: {} }, async () => ({
  content: [{ type: "text", text: JSON.stringify({ private_key: "-----BEGIN OPENSSH PRIVATE KEY-----\nX\n-----END OPENSSH PRIVATE KEY-----", status: "finished" }) }]
}));
handlers["coolify_get_deployment"]({}, {}).then(r => {
  const ok = !r.content[0].text.includes("BEGIN OPENSSH") && r.content[0].text.includes("***") && r.content[0].text.includes("finished");
  console.log(ok ? "SMOKE OK: deploy key redacted, status preserved" : "SMOKE FAIL");
  process.exit(ok ? 0 : 1);
});
'
```

Expected: `SMOKE OK: deploy key redacted, status preserved`.

- [ ] **Step 3: Document in `CLAUDE.md`**

In `src/index.ts`'s description area of `CLAUDE.md` Patterns/Architecture, add a "Secret redaction" note (under Patterns):

```markdown
- **Central secret redaction:** `installRedaction(server)` (`src/utils/register-sanitized.ts`) patches `registerTool` once so EVERY tool response is redacted by default (`src/utils/redaction.ts`: secret field-names + value-shapes — PEM keys, JWTs, token prefixes, connection-string passwords). Redaction precedes truncation (`jsonResponse` is serialize-only; the wrapper truncates). Opt out per-call with `reveal: true` (audited via high-power-audit-log); pure value-read tools (`vps_read_file`, `vps_exec`, `vps_docker_logs`, `cloudflare_get_kv_value`, `cloudflare_query_d1`, `namecheap_domains_get_contacts`) are in `ALWAYS_BYPASS`. Kill switch: `INFRAOPS_DISABLE_REDACTION=1`. Existing `masking.ts`/`env-vars.ts`/`private-keys.ts` masks stay as defense-in-depth.
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/index.ts CLAUDE.md dist/
git commit -m "feat(redaction): wire installRedaction into the server + document

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- Patch `registerTool` once, inject reveal, wrap handler → Task 3 + Task 4 ✓
- Pure name + value-shape redactor, Balanced + guards → Task 1 ✓
- Redact-before-truncate (jsonResponse serialize-only; wrapper truncates) → Task 2 + Task 3 ✓
- 3-tier opt-out (default / reveal / ALWAYS_BYPASS) → Task 3 ✓
- supabase_get_api_keys behind reveal → automatic (central default redacts its JWTs; reveal injected) — covered by Task 3's default-redaction; no per-tool change needed ✓
- Reveal injection only if absent; error responses sanitized → Task 3 tests ✓
- Kill switch → Task 3 ✓
- Defense-in-depth (existing masks untouched) → no task removes them ✓
- dist/ tracked → every task builds + commits dist/ ✓
- Docs → Task 4 ✓
- Rotation of the exposed key → explicitly out of scope (spec) ✓

**Placeholder scan:** none — all code, paths, commands concrete.

**Type/name consistency:** `isSecretName` / `redactText` / `deepRedact` (Task 1) ↔ imported in Task 3. `truncateToLimit` (Task 2) ↔ imported in Task 3. `installRedaction` / `ALWAYS_BYPASS` (Task 3) ↔ used in Task 4. `reveal` field name consistent across wrapper and tests.

**Note for the implementer:** `tests/response-util.test.ts` already exists and may assert the OLD truncating `jsonResponse`. Task 2 Step 1 says to replace those specific assertions; read the file first and adjust existing truncation assertions rather than duplicating.
