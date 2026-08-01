# App-brain repo+branch resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app-conformance handoff brief resolve `github_repo` + `target_branch` from app-brain's REST resolve endpoint (uuid-primary, fqdn-fallback), failing safe to `UNCONFIRMED`, replacing the unreliable `resource_name` parse.

**Architecture:** A new HTTP client (`appbrain-client.ts`, mirroring `infrabrain-client.ts`) calls `GET /api/apps/resolve`. The handoff builder's injected seam changes from a boolean repo-confirmer to a structured resolver keyed on `proposal.target.uuid` (stable app UUID) + the host parsed from the probe URL. Confirmation requires BOTH a non-empty repo AND branch; every other outcome → `UNCONFIRMED` (repo + branch together), logged distinctly so a resolver outage is visible.

**Tech Stack:** TypeScript, Node 18+, axios, vitest, Zod (already in repo). Spec: `docs/superpowers/specs/2026-06-26-appbrain-repo-branch-resolution-design.md`.

## Global Constraints

- `dist/` is tracked and CI-enforced to match a fresh build — every change that touches `src/` must end with `npm run build` + `git add dist/` in the same commit (final task).
- `main` is branch-protected — work on branch `feat/appbrain-repo-branch-resolution` (already checked out), deliver via PR.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. Tests run with `npx vitest run`.
- No secrets in tracked files. Secrets come from BWS at runtime via `start.sh` / `drift-audit.sh`.
- No network in tests — inject fakes / mock axios.
- Node ESM imports use the `.js` extension on relative paths even for `.ts` sources (repo convention).
- The app-brain access key is the SAME value as infra-brain's for v1, but wired via its own `BWS_APPBRAIN_SECRET_ID` var (default `45eb083f-4b05-4251-924d-b46700e5a643`).
- Endpoint contract: `GET /api/apps/resolve?coolify_app_uuid=&fqdn=` → `200 {github_repo, name, branch, url}` (github_repo/branch/url may be null) | `404 {error}` | `400` (neither param). Auth: `x-brain-key` header.

---

### Task 1: `appbrain-client.ts` — the HTTP resolver client

**Files:**

- Create: `src/services/appbrain-client.ts`
- Test: `tests/appbrain-client.test.ts`

**Interfaces:**

- Consumes: `REQUEST_TIMEOUT` from `../constants.js` (= 30000); `axios`.
- Produces:
  - `interface AppResolution { github_repo: string | null; name: string; branch: string | null; url: string | null }`
  - `function isAppbrainConfigured(): boolean`
  - `function validateResolution(body: unknown): AppResolution` (throws on type-malformed body)
  - `async function resolveApp(args: { coolifyAppUuid: string; fqdn: string | null }): Promise<AppResolution | null>` (200→validated body; 404→null; else throws)

- [ ] **Step 1: Write the failing test**

Create `tests/appbrain-client.test.ts` (mirrors `tests/infrabrain-client.test.ts` mocking style):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => {
  const instance = { get: vi.fn() };
  const create = vi.fn(() => instance);
  return {
    default: { create, isAxiosError: vi.fn() },
    isAxiosError: vi.fn(),
    AxiosError: class AxiosError extends Error {},
    __mockInstance: instance,
  };
});

import axios from 'axios';

const setEnv = () => {
  process.env.APPBRAIN_BASE_URL = 'https://app-brain.devonwatkins.com';
  process.env.APPBRAIN_ACCESS_KEY = 'secret-key-value';
};

describe('appbrain-client', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved.APPBRAIN_BASE_URL = process.env.APPBRAIN_BASE_URL;
    saved.APPBRAIN_ACCESS_KEY = process.env.APPBRAIN_ACCESS_KEY;
    vi.resetModules();
  });
  afterEach(() => {
    process.env.APPBRAIN_BASE_URL = saved.APPBRAIN_BASE_URL;
    process.env.APPBRAIN_ACCESS_KEY = saved.APPBRAIN_ACCESS_KEY;
    vi.restoreAllMocks();
  });

  describe('isAppbrainConfigured', () => {
    it('true when both env vars set', async () => {
      setEnv();
      const { isAppbrainConfigured } = await import('../src/services/appbrain-client.js');
      expect(isAppbrainConfigured()).toBe(true);
    });
    it('false when key missing', async () => {
      process.env.APPBRAIN_BASE_URL = 'https://app-brain.devonwatkins.com';
      delete process.env.APPBRAIN_ACCESS_KEY;
      const { isAppbrainConfigured } = await import('../src/services/appbrain-client.js');
      expect(isAppbrainConfigured()).toBe(false);
    });
  });

  describe('validateResolution', () => {
    it('accepts a full booking body', async () => {
      const { validateResolution } = await import('../src/services/appbrain-client.js');
      expect(
        validateResolution({
          github_repo: 'AlobarQuest/booking-system',
          name: 'prod',
          branch: 'master',
          url: 'https://booking.devonwatkins.com',
        }),
      ).toEqual({
        github_repo: 'AlobarQuest/booking-system',
        name: 'prod',
        branch: 'master',
        url: 'https://booking.devonwatkins.com',
      });
    });
    it('accepts null github_repo/branch/url (valid-but-incomplete)', async () => {
      const { validateResolution } = await import('../src/services/appbrain-client.js');
      expect(
        validateResolution({ github_repo: null, name: 'prod', branch: null, url: null }),
      ).toEqual({ github_repo: null, name: 'prod', branch: null, url: null });
    });
    it('throws on wrong-typed branch', async () => {
      const { validateResolution } = await import('../src/services/appbrain-client.js');
      expect(() =>
        validateResolution({ github_repo: 'o/r', name: 'prod', branch: 123, url: null }),
      ).toThrow();
    });
    it('throws on missing/empty name', async () => {
      const { validateResolution } = await import('../src/services/appbrain-client.js');
      expect(() =>
        validateResolution({ github_repo: 'o/r', name: '', branch: 'master', url: null }),
      ).toThrow();
    });
    it('throws on non-object', async () => {
      const { validateResolution } = await import('../src/services/appbrain-client.js');
      expect(() => validateResolution(null)).toThrow();
    });
  });

  describe('resolveApp', () => {
    const mockGet = () => (axios as any).__mockInstance.get as ReturnType<typeof vi.fn>;
    it('200 → validated body; sends uuid param + x-brain-key header', async () => {
      setEnv();
      const { resolveApp } = await import('../src/services/appbrain-client.js');
      mockGet().mockResolvedValue({
        status: 200,
        data: {
          github_repo: 'AlobarQuest/booking-system',
          name: 'prod',
          branch: 'master',
          url: 'https://booking.devonwatkins.com',
        },
      });
      const r = await resolveApp({ coolifyAppUuid: 'hkw488ggssgcskk0ooc0ksk0', fqdn: null });
      expect(r?.branch).toBe('master');
      const createCfg = (axios.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCfg.headers['x-brain-key']).toBe('secret-key-value');
      const getCall = mockGet().mock.calls[0];
      expect(getCall[0]).toBe('/api/apps/resolve');
      expect(getCall[1].params).toEqual({ coolify_app_uuid: 'hkw488ggssgcskk0ooc0ksk0' }); // fqdn omitted when null
    });
    it('includes fqdn param when provided', async () => {
      setEnv();
      const { resolveApp } = await import('../src/services/appbrain-client.js');
      mockGet().mockResolvedValue({
        status: 200,
        data: { github_repo: 'o/r', name: 'preview', branch: 'preview', url: null },
      });
      await resolveApp({ coolifyAppUuid: 'u1', fqdn: 'preview.booking.devonwatkins.com' });
      expect(mockGet().mock.calls[0][1].params).toEqual({
        coolify_app_uuid: 'u1',
        fqdn: 'preview.booking.devonwatkins.com',
      });
    });
    it('404 → null', async () => {
      setEnv();
      const { resolveApp } = await import('../src/services/appbrain-client.js');
      mockGet().mockResolvedValue({ status: 404, data: { error: 'not_found' } });
      expect(await resolveApp({ coolifyAppUuid: 'nope', fqdn: null })).toBeNull();
    });
    it('malformed 200 body → throws', async () => {
      setEnv();
      const { resolveApp } = await import('../src/services/appbrain-client.js');
      mockGet().mockResolvedValue({ status: 200, data: { name: 'prod', branch: 5 } });
      await expect(resolveApp({ coolifyAppUuid: 'u1', fqdn: null })).rejects.toThrow();
    });
    it('network error → throws', async () => {
      setEnv();
      const { resolveApp } = await import('../src/services/appbrain-client.js');
      mockGet().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(resolveApp({ coolifyAppUuid: 'u1', fqdn: null })).rejects.toThrow();
    });
    it('rejects an http:// base URL (cleartext key)', async () => {
      process.env.APPBRAIN_BASE_URL = 'http://app-brain.devonwatkins.com';
      process.env.APPBRAIN_ACCESS_KEY = 'k';
      const { resolveApp } = await import('../src/services/appbrain-client.js');
      await expect(resolveApp({ coolifyAppUuid: 'u1', fqdn: null })).rejects.toThrow(/https/i);
    });
    it('rejects a credentialed base URL', async () => {
      process.env.APPBRAIN_BASE_URL = 'https://user:pass@app-brain.devonwatkins.com';
      process.env.APPBRAIN_ACCESS_KEY = 'k';
      const { resolveApp } = await import('../src/services/appbrain-client.js');
      await expect(resolveApp({ coolifyAppUuid: 'u1', fqdn: null })).rejects.toThrow(/credential/i);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/appbrain-client.test.ts`
Expected: FAIL — `Cannot find module '../src/services/appbrain-client.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/appbrain-client.ts`:

```typescript
import axios, { AxiosInstance } from 'axios';
import { REQUEST_TIMEOUT } from '../constants.js';

/** A resolved app-brain environment. github_repo/branch/url may be null per the contract;
 *  the handoff builder treats a null/empty repo OR branch as UNCONFIRMED. */
export interface AppResolution {
  github_repo: string | null;
  name: string;
  branch: string | null;
  url: string | null;
}

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (_client) return _client;

  const baseURL = process.env.APPBRAIN_BASE_URL;
  const key = process.env.APPBRAIN_ACCESS_KEY;
  if (!baseURL || !key) {
    throw new Error('app-brain is not configured. Set APPBRAIN_BASE_URL and APPBRAIN_ACCESS_KEY.');
  }

  // Config hardening: this client ships a secret-bearing x-brain-key, so refuse to send it
  // over cleartext or to a credential-spoofed host (panel MED-4).
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error(`APPBRAIN_BASE_URL is not a valid URL: ${baseURL}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`APPBRAIN_BASE_URL must be https — refusing to send x-brain-key in cleartext.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('APPBRAIN_BASE_URL must not contain credentials.');
  }

  _client = axios.create({
    baseURL,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-brain-key': key,
    },
  });
  return _client;
}

const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** Type-validate the 200 body. Throws on a malformed shape (treated as a resolver error upstream,
 *  never confirmed). github_repo/branch/url may legitimately be null — that is incomplete, not
 *  malformed, and is resolved to UNCONFIRMED by the handoff builder. */
export function validateResolution(body: unknown): AppResolution {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new Error('app-brain resolve: body is not an object');
  if (typeof b.name !== 'string' || b.name.trim() === '')
    throw new Error('app-brain resolve: name missing/empty');
  if (!strOrNull(b.github_repo))
    throw new Error('app-brain resolve: github_repo must be string or null');
  if (!strOrNull(b.branch)) throw new Error('app-brain resolve: branch must be string or null');
  if (!strOrNull(b.url)) throw new Error('app-brain resolve: url must be string or null');
  return {
    github_repo: (b.github_repo as string | null) ?? null,
    name: b.name,
    branch: (b.branch as string | null) ?? null,
    url: (b.url as string | null) ?? null,
  };
}

/** Resolve a Coolify app to its repo+branch. 200 → validated body; 404 → null; anything else throws. */
export async function resolveApp(args: {
  coolifyAppUuid: string;
  fqdn: string | null;
}): Promise<AppResolution | null> {
  const client = getClient();
  const params: Record<string, string> = { coolify_app_uuid: args.coolifyAppUuid };
  if (args.fqdn) params.fqdn = args.fqdn;
  const res = await client.get('/api/apps/resolve', {
    params,
    validateStatus: (s) => s === 200 || s === 404,
  });
  if (res.status === 404) return null;
  return validateResolution(res.data);
}

export function isAppbrainConfigured(): boolean {
  return !!(process.env.APPBRAIN_BASE_URL && process.env.APPBRAIN_ACCESS_KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/appbrain-client.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/services/appbrain-client.ts tests/appbrain-client.test.ts
git commit -m "feat(appbrain): HTTP resolve client (uuid/fqdn -> repo+branch), https-hardened"
```

---

### Task 2: `hostFromUrl` — safe host extraction

**Files:**

- Modify: `src/standards/handoff-brief.ts` (add the exported function; leave existing code untouched for now)
- Test: `tests/handoff-brief.test.ts` (add a new `describe` block)

**Interfaces:**

- Produces: `function hostFromUrl(url: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing test**

Add to `tests/handoff-brief.test.ts` (and add `hostFromUrl` to the import on line 2):

```typescript
describe('hostFromUrl', () => {
  it('extracts lowercased hostname', () =>
    expect(hostFromUrl('https://Booking.DevonWatkins.com/api/health')).toBe(
      'booking.devonwatkins.com',
    ));
  it('drops a :port', () =>
    expect(hostFromUrl('https://booking.devonwatkins.com:8443/api/health')).toBe(
      'booking.devonwatkins.com',
    ));
  it('strips path / trailing slash', () =>
    expect(hostFromUrl('https://booking.devonwatkins.com/')).toBe('booking.devonwatkins.com'));
  it('rejects userinfo (credential spoofing) → null', () =>
    expect(hostFromUrl('https://user:pass@booking.devonwatkins.com/x')).toBeNull());
  it('rejects non-http scheme → null', () => expect(hostFromUrl('file:///etc/passwd')).toBeNull());
  it('null / empty / garbage → null', () => {
    expect(hostFromUrl(null)).toBeNull();
    expect(hostFromUrl('')).toBeNull();
    expect(hostFromUrl('not a url')).toBeNull();
    expect(hostFromUrl('booking.devonwatkins.com, other.com')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/handoff-brief.test.ts -t hostFromUrl`
Expected: FAIL — `hostFromUrl is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Add to `src/standards/handoff-brief.ts` (near the top, after the imports):

```typescript
/** Parse a bare host from a URL. http/https only; reject userinfo; return the lowercased hostname
 *  (no port); null on any invalid/unsafe input. Coolify app fields are not a trust boundary. */
export function hostFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.trim() === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  return host === '' ? null : host;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/handoff-brief.test.ts -t hostFromUrl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/standards/handoff-brief.ts tests/handoff-brief.test.ts
git commit -m "feat(handoff): hostFromUrl — safe host extraction (new URL, no userinfo)"
```

---

### Task 3: Rework the handoff seam — delete the resource_name parse, wire the resolver

**Files:**

- Modify: `src/standards/handoff-brief.ts` (delete `resolveRepo`, `parseTargetBranch`, old `HandoffDeps`; new `HandoffDeps`; rework `buildHandoff`; normalize `buildHandoffPackage`)
- Test: `tests/handoff-brief.test.ts` (delete the `resolveRepo` describe block; rework `buildHandoff` block; extend `buildHandoffPackage` block)

**Interfaces:**

- Consumes: `AppResolution` + `resolveApp` signature from Task 1 (`src/services/appbrain-client.js`); `hostFromUrl` from Task 2; `axios` (for `isAxiosError` status classification in the catch).
- Produces:
  - `interface HandoffDeps { appBrainResolve?: (args: { coolifyAppUuid: string; fqdn: string | null }) => Promise<AppResolution | null> }`
  - `buildHandoff(proposal, probe, url, instance, deps?)` — unchanged signature, new internals.
  - `buildHandoffPackage` — `targetBranch` param type widened to `string | null`; normalizes so repo+branch are both confirmed or both `"UNCONFIRMED"`.

- [ ] **Step 1: Write the failing tests**

In `tests/handoff-brief.test.ts`: (a) remove the entire `describe("resolveRepo", …)` block and drop `resolveRepo` from the import; (b) replace the `describe("buildHandoff", …)` block and extend `buildHandoffPackage` with:

```typescript
describe('buildHandoffPackage normalization', () => {
  it("repo null + branch 'main' → BOTH UNCONFIRMED (no half-confirmed target)", () => {
    const p = buildHandoffPackage({
      repo: null,
      targetBranch: 'main',
      rule: 'r',
      path: '/api/health',
      url: null,
      probeReason: 'HTTP 404',
    });
    expect(p.repo).toBe('UNCONFIRMED');
    expect(p.target_branch).toBe('UNCONFIRMED');
  });
  it('repo set + branch null → BOTH UNCONFIRMED', () => {
    const p = buildHandoffPackage({
      repo: 'AlobarQuest/booking-system',
      targetBranch: null,
      rule: 'r',
      path: '/api/health',
      url: null,
      probeReason: 'HTTP 404',
    });
    expect(p.repo).toBe('UNCONFIRMED');
    expect(p.target_branch).toBe('UNCONFIRMED');
  });
  it('both set → confirmed, verbatim (no lowercasing)', () => {
    const p = buildHandoffPackage({
      repo: 'AlobarQuest/booking-system',
      targetBranch: 'master',
      rule: 'r',
      path: '/api/health',
      url: null,
      probeReason: 'HTTP 404',
    });
    expect(p.repo).toBe('AlobarQuest/booking-system');
    expect(p.target_branch).toBe('master');
  });
});

describe('buildHandoff resolution via app-brain', () => {
  const hc = (path = '/api/health') =>
    ({
      id: 'coolify.enable_healthcheck:u1',
      target: {
        provider: 'coolify',
        resource_type: 'application',
        uuid: 'hkw488ggssgcskk0ooc0ksk0',
        name: 'alobar-quest/booking-system:main',
      },
      planned_action: { tool: 'coolify_update_application', args: { health_check_path: path } },
    }) as any;
  const probe = { status: 404, reason: 'HTTP 404' };

  it('confirmed: resolver returns repo+branch (uuid primary)', async () => {
    const resolve = async () => ({
      github_repo: 'AlobarQuest/booking-system',
      name: 'prod',
      branch: 'master',
      url: 'https://booking.devonwatkins.com',
    });
    const out = await buildHandoff(
      hc(),
      probe,
      'https://booking.devonwatkins.com/api/health',
      'prod',
      { appBrainResolve: resolve },
    );
    expect(out.lane).toBe('app-conformance');
    expect(out.handoff?.repo).toBe('AlobarQuest/booking-system');
    expect(out.handoff?.target_branch).toBe('master');
  });
  it('passes uuid + parsed fqdn to the resolver', async () => {
    let seen: any;
    const resolve = async (a: any) => {
      seen = a;
      return { github_repo: 'o/r', name: 'preview', branch: 'preview', url: null };
    };
    await buildHandoff(hc(), probe, 'https://preview.booking.devonwatkins.com/api/health', 'prod', {
      appBrainResolve: resolve,
    });
    expect(seen).toEqual({
      coolifyAppUuid: 'hkw488ggssgcskk0ooc0ksk0',
      fqdn: 'preview.booking.devonwatkins.com',
    });
  });
  it('404 (null) → UNCONFIRMED', async () => {
    const out = await buildHandoff(
      hc(),
      probe,
      'https://booking.devonwatkins.com/api/health',
      'prod',
      { appBrainResolve: async () => null },
    );
    expect(out.handoff?.repo).toBe('UNCONFIRMED');
    expect(out.handoff?.target_branch).toBe('UNCONFIRMED');
  });
  it('null branch → UNCONFIRMED (both)', async () => {
    const out = await buildHandoff(
      hc(),
      probe,
      'https://booking.devonwatkins.com/api/health',
      'prod',
      {
        appBrainResolve: async () => ({
          github_repo: 'AlobarQuest/booking-system',
          name: 'prod',
          branch: null,
          url: null,
        }),
      },
    );
    expect(out.handoff?.repo).toBe('UNCONFIRMED');
    expect(out.handoff?.target_branch).toBe('UNCONFIRMED');
  });
  it('null github_repo → UNCONFIRMED (both)', async () => {
    const out = await buildHandoff(
      hc(),
      probe,
      'https://booking.devonwatkins.com/api/health',
      'prod',
      {
        appBrainResolve: async () => ({
          github_repo: null,
          name: 'prod',
          branch: 'master',
          url: null,
        }),
      },
    );
    expect(out.handoff?.repo).toBe('UNCONFIRMED');
    expect(out.handoff?.target_branch).toBe('UNCONFIRMED');
  });
  it('resolver throws → UNCONFIRMED, no propagation', async () => {
    const out = await buildHandoff(
      hc(),
      probe,
      'https://booking.devonwatkins.com/api/health',
      'prod',
      {
        appBrainResolve: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    );
    expect(out.handoff?.repo).toBe('UNCONFIRMED');
  });
  it('no resolver injected → UNCONFIRMED (never the resource_name parse)', async () => {
    const out = await buildHandoff(
      hc(),
      probe,
      'https://booking.devonwatkins.com/api/health',
      'prod',
    );
    expect(out.handoff?.repo).toBe('UNCONFIRMED');
    expect(out.handoff?.target_branch).toBe('UNCONFIRMED');
  });
  it('timeout → infra-config, no handoff', async () => {
    const out = await buildHandoff(
      hc(),
      { status: null, reason: 'AbortError' },
      undefined,
      'prod',
      { appBrainResolve: async () => null },
    );
    expect(out.lane).toBe('infra-config');
    expect(out.handoff).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/handoff-brief.test.ts`
Expected: FAIL — `resolveApp`/`appBrainResolve` not wired; `buildHandoff` still parses `resource_name` so `repo` comes back `"booking-system"` not `"UNCONFIRMED"`; `buildHandoffPackage` does not normalize.

- [ ] **Step 3: Write the implementation**

In `src/standards/handoff-brief.ts`:

(a) Update imports at the top:

```typescript
import axios from 'axios';
import type { Proposal } from './check-engine.js';
import type { ProbeResult } from './executor.js';
import type { Lane } from './remediation-registry.js';
import type { AppResolution } from '../services/appbrain-client.js';
```

(b) Replace the old `HandoffDeps` interface (lines 5-8) and DELETE `resolveRepo` (lines 23-38) and `parseTargetBranch` (lines 52-57). New seam:

```typescript
/** Injected app-brain resolver seam. Production wires the real resolveApp; tests inject a fake.
 *  Returns the matched env (repo/branch may be null) or null on no-match. */
export interface HandoffDeps {
  appBrainResolve?: (args: {
    coolifyAppUuid: string;
    fqdn: string | null;
  }) => Promise<AppResolution | null>;
}

const isNonEmpty = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim() !== '';
```

(c) Normalize `buildHandoffPackage` — change its `targetBranch` param to `string | null` and force both-or-neither:

```typescript
export function buildHandoffPackage(args: {
  repo: string | null;
  targetBranch: string | null;
  rule: string;
  path: string;
  url: string | null;
  probeReason: string;
}): HandoffPackage {
  const { repo, targetBranch, rule, path, url, probeReason } = args;
  // repo and branch travel together: if either is missing/unconfirmed, BOTH are UNCONFIRMED —
  // a half-confirmed dispatch target must be unrepresentable (panel MED-5 / HIGH-1).
  const confirmed =
    isNonEmpty(repo) &&
    repo !== 'UNCONFIRMED' &&
    isNonEmpty(targetBranch) &&
    targetBranch !== 'UNCONFIRMED';
  const finalRepo = confirmed ? (repo as string) : 'UNCONFIRMED';
  const finalBranch = confirmed ? (targetBranch as string) : 'UNCONFIRMED';
  const target = url ?? `https://<fqdn>${path}`;
  return {
    repo: finalRepo,
    target_branch: finalBranch,
    rule,
    verified_gap: `Probe ${target} → ${probeReason}; the app does not serve the standard health path ${path}. The infra health-check enable was correctly held by the probe-guard.`,
    required_change: `In repo ${finalRepo}${finalRepo === 'UNCONFIRMED' ? ' — confirm before dispatch' : ''} (branch ${finalBranch}): add a handler serving ${path} returning 2xx (mirror the app's existing health response). Keep any existing health path working.`,
    acceptance_check: `GET ${target} returns 2xx. Once it does, the next drift scan's probe-guard passes and the infra health-check auto-enables; the change-manager item then auto-resolves.`,
    scope_guard:
      'App repo only. Open a PR; do NOT deploy. Do NOT use any infra/Coolify/secret tools.',
    do_nots: [
      'Do NOT hand-resolve or wontfix the change-manager item.',
      'Do NOT touch Coolify config or enable the health check manually.',
      'Do NOT change unrelated routes.',
    ],
  };
}
```

(d) Rework `buildHandoff` (the resolution block + the `buildHandoffPackage` call):

```typescript
export async function buildHandoff(
  proposal: Proposal,
  probe: ProbeResult | undefined,
  url: string | undefined,
  instance: string,
  deps: HandoffDeps = {},
): Promise<{ lane: Lane; handoff?: HandoffPackage; handoff_brief?: string }> {
  const lane = classifyLane(probe);
  if (lane !== 'app-conformance') return { lane: 'infra-config' };
  const path = String(
    (proposal.planned_action?.args as Record<string, unknown> | undefined)?.health_check_path ??
      '/api/health',
  );

  // Authoritative resolution via app-brain. PRIMARY key = the stable Coolify app UUID
  // (proposal.target.uuid); FALLBACK = the host from the probe URL. Never the resource_name.
  const coolifyAppUuid = String(proposal.target.uuid ?? '');
  const fqdn = hostFromUrl(url);
  let repo: string | null = null;
  let targetBranch: string | null = null;
  if (deps.appBrainResolve) {
    try {
      const r = await deps.appBrainResolve({ coolifyAppUuid, fqdn });
      if (r === null) {
        console.info(
          `[handoff] no app-brain match (uuid=${coolifyAppUuid} fqdn=${fqdn ?? '—'}) → UNCONFIRMED`,
        );
      } else if (isNonEmpty(r.github_repo) && isNonEmpty(r.branch)) {
        repo = r.github_repo;
        targetBranch = r.branch;
      } else {
        console.warn(
          `[handoff] app-brain matched (name=${r.name}) but repo/branch incomplete (repo=${r.github_repo ?? 'null'} branch=${r.branch ?? 'null'}) → UNCONFIRMED`,
        );
      }
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      if (status === 401 || status === 403) {
        console.error(
          `[handoff] app-brain auth rejected (HTTP ${status}) — check APPBRAIN_ACCESS_KEY → UNCONFIRMED`,
        );
      } else {
        console.error(
          `[handoff] app-brain resolver unreachable (${e instanceof Error ? e.message : String(e)}) → UNCONFIRMED`,
        );
      }
    }
  } else {
    console.info('[handoff] no app-brain resolver configured → UNCONFIRMED');
  }

  const rule = proposal.id.split(':')[0];
  const handoff = buildHandoffPackage({
    repo,
    targetBranch,
    rule,
    path,
    url: url ?? null,
    probeReason: probe?.reason ?? 'non-2xx',
  });
  return { lane, handoff, handoff_brief: renderHandoffBrief(handoff) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/handoff-brief.test.ts`
Expected: PASS. (The pre-existing `buildHandoffPackage` test "uses UNCONFIRMED when repo is null" still passes — both fields go UNCONFIRMED.)

- [ ] **Step 5: Commit**

```bash
git add src/standards/handoff-brief.ts tests/handoff-brief.test.ts
git commit -m "feat(handoff): resolve repo+branch from app-brain; delete resource_name parse

Confirm requires both repo AND branch; 404/null/error/no-resolver -> UNCONFIRMED
(logged distinctly). Deletes the wrong-branch resource_name parse (booking would
yield 'main' when the real branch is 'master')."
```

---

### Task 4: Thread the resolver through `run-remediation.ts`

**Files:**

- Modify: `src/standards/run-remediation.ts` (rename `appBrainLookup` → `appBrainResolve` in `RemediationDeps`; pass to `buildHandoff`)
- Test: `tests/run-remediation-handoff.test.ts` (inject the fake resolver so the confirmed-repo assertion still holds)

**Interfaces:**

- Consumes: `HandoffDeps`/`AppResolution` shape from Task 3 + `src/services/appbrain-client.js`.
- Produces: `RemediationDeps.appBrainResolve?: (args: { coolifyAppUuid: string; fqdn: string | null }) => Promise<AppResolution | null>`.

- [ ] **Step 1: Update the failing test**

In `tests/run-remediation-handoff.test.ts`, add an injected resolver to `baseDeps` and update the confirmed-repo expectation. Change the `baseDeps` factory to accept and pass a resolver, and in the first test inject one returning booking:

```typescript
import type { AppResolution } from '../src/services/appbrain-client.js';

const baseDeps = (verify: any, appBrainResolve?: any) => ({
  audit: async () => ({ proposals: [hcProposal('u1')], meta: { errors: [] } }) as any,
  apply: async () => ({ status: 'applied', tool: 't', target: { name: 'x' }, detail: '' }) as any,
  plan: async () =>
    ({
      generated_by: 'test',
      root_cause: 'x',
      steps: ['s'],
      infraops_tools: [],
      risk: 'caution',
      rollback: 'r',
      cm_window_hint: 'h',
    }) as any,
  verify,
  appBrainResolve,
  maxAutoApplies: 20,
  dryRun: false,
});

// in the "404 hold" test, inject a resolver returning the confirmed booking record:
const resolve = async (): Promise<AppResolution> => ({
  github_repo: 'AlobarQuest/booking-system',
  name: 'prod',
  branch: 'master',
  url: 'https://booking/api/health',
});
const { report } = await runRemediation(
  ['prod'] as any,
  null,
  't',
  'r.json',
  baseDeps(
    async () => ({
      ok: false,
      reason: 'held',
      probe: { status: 404, reason: 'HTTP 404' },
      url: 'https://booking.devonwatkins.com/api/health',
    }),
    resolve,
  ),
);
const e = report.escalations[0];
expect(e.lane).toBe('app-conformance');
expect(e.handoff?.repo).toBe('AlobarQuest/booking-system');
expect(e.handoff?.target_branch).toBe('master');
expect(e.handoff_brief).toContain('AlobarQuest/booking-system');
```

(The timeout test is unchanged — it still yields infra-config with no handoff.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/run-remediation-handoff.test.ts`
Expected: FAIL — `appBrainResolve` is not a recognized dep / not passed to `buildHandoff`, so `repo` is `UNCONFIRMED`, not `AlobarQuest/booking-system`.

- [ ] **Step 3: Write the implementation**

In `src/standards/run-remediation.ts`:

(a) Add the import near the other type imports:

```typescript
import type { AppResolution } from '../services/appbrain-client.js';
```

(b) Replace line 22 (`appBrainLookup?: …`) in `RemediationDeps`:

```typescript
  appBrainResolve?: (args: { coolifyAppUuid: string; fqdn: string | null }) => Promise<AppResolution | null>;
```

(c) Replace the `buildHandoff` call (lines 104-107):

```typescript
const { lane, handoff, handoff_brief } = await buildHandoff(
  t.proposal,
  t.probe,
  t.url,
  t.instance,
  deps.appBrainResolve ? { appBrainResolve: deps.appBrainResolve } : {},
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/run-remediation-handoff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/standards/run-remediation.ts tests/run-remediation-handoff.test.ts
git commit -m "feat(remediation): thread appBrainResolve through to the handoff builder"
```

---

### Task 5: Wire the real client in `remediate-cli.ts`

**Files:**

- Modify: `src/cli/remediate-cli.ts` (construct `appBrainResolve` from the real `resolveApp` when configured)

**Interfaces:**

- Consumes: `resolveApp`, `isAppbrainConfigured` from `../services/appbrain-client.js`; `RemediationDeps.appBrainResolve` from Task 4.

- [ ] **Step 1: Implementation (no new unit test — covered by Task 4's injected path; this is the production wiring)**

In `src/cli/remediate-cli.ts`:

(a) Add the import after line 9:

```typescript
import { resolveApp, isAppbrainConfigured } from '../services/appbrain-client.js';
```

(b) In the `runRemediation` deps object literal (lines 87-94), add the conditional resolver. Replace the object with:

```typescript
    {
      audit: (inst) => auditInstance(inst),
      apply: (p, inst, opts) => applyAction(p, inst, opts),
      plan: (p) => planEscalation(p, getAnthropic()),
      verify: (p, inst) => verifySafe(p, inst),
      ...(isAppbrainConfigured() ? { appBrainResolve: (a: { coolifyAppUuid: string; fqdn: string | null }) => resolveApp(a) } : {}),
      maxAutoApplies: maxAutoApplies(),
      dryRun,
    },
```

When app-brain env vars are absent, `appBrainResolve` is omitted → every handoff fails safe to UNCONFIRMED (same as the v1 unwired state, but explicit).

- [ ] **Step 2: Verify the suite still passes + typechecks**

Run: `npx vitest run`
Expected: PASS (full suite). The CLI wiring is type-checked by the build in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/cli/remediate-cli.ts
git commit -m "feat(cli): wire real app-brain resolver into remediate-cli when configured"
```

---

### Task 6: Env wiring — `drift-audit.sh`, `start.sh`, `scripts/README.md`

**Files:**

- Modify: `scripts/drift-audit.sh` (after the infra-brain block, ~line 55)
- Modify: `start.sh` (after the infra-brain block, ~line 161)
- Modify: `scripts/README.md` (env table)

**Interfaces:** none (shell env only).

- [ ] **Step 1: Add the app-brain block to `scripts/drift-audit.sh`**

Immediately after the infra-brain `export INFRABRAIN_ACCESS_KEY=…` line (~55), insert:

```bash
# ── app-brain (repo+branch resolution for app-conformance handoffs) ─────────────
# Shared MCP_ACCESS_KEY value as infra-brain for v1, via its own var so app-brain's
# key can diverge later with no code change (default = infra-brain's secret UUID).
export APPBRAIN_BASE_URL="${APPBRAIN_BASE_URL:-https://app-brain.devonwatkins.com}"
export APPBRAIN_ACCESS_KEY="$(get_secret_by_id "${BWS_APPBRAIN_SECRET_ID:-45eb083f-4b05-4251-924d-b46700e5a643}")"
```

- [ ] **Step 2: Add the matching block to `start.sh`**

Immediately after `start.sh`'s `export INFRABRAIN_ACCESS_KEY=…` line, insert (note `start.sh` uses `fetch_bws_secret`):

```bash
# ── app-brain (repo+branch resolution for app-conformance handoffs) ────
export APPBRAIN_BASE_URL="${APPBRAIN_BASE_URL:-https://app-brain.devonwatkins.com}"
export APPBRAIN_ACCESS_KEY=$(fetch_bws_secret "${BWS_APPBRAIN_SECRET_ID:-45eb083f-4b05-4251-924d-b46700e5a643}")
```

- [ ] **Step 3: Update `scripts/README.md` env table**

Add a row mirroring the infra-brain entry (line ~22), e.g.:

```
   - app-brain key (`APPBRAIN_ACCESS_KEY`) — `BWS_APPBRAIN_SECRET_ID` (shared with infra-brain for v1); base URL `APPBRAIN_BASE_URL`
```

- [ ] **Step 4: Syntax-check the shell scripts**

Run: `bash -n scripts/drift-audit.sh && bash -n start.sh && echo OK`
Expected: `OK` (no syntax errors).

- [ ] **Step 5: Commit**

```bash
git add scripts/drift-audit.sh start.sh scripts/README.md
git commit -m "feat(env): wire APPBRAIN_BASE_URL/ACCESS_KEY into drift-audit.sh + start.sh"
```

---

### Task 7: Build, full suite, live verify, commit `dist/`

**Files:**

- Modify: `dist/**` (compiled output — tracked, must match a fresh build)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS — entire suite green (no regressions in `executor`, `audit`, `remediation-*`, etc.).

- [ ] **Step 2: Fresh build**

Run: `npm run build`
Expected: tsc completes with no type errors (this is what catches the `remediate-cli.ts` wiring + the widened `buildHandoffPackage` signature).

- [ ] **Step 3: Confirm `dist/` matches the build (CI gate parity)**

Run: `git status --porcelain dist/`
Expected: lists the changed `dist/` files (e.g. `dist/services/appbrain-client.js`, `dist/standards/handoff-brief.js`, `dist/standards/run-remediation.js`, `dist/cli/remediate-cli.js` + `.d.ts`/`.map` siblings). If empty after edits, the build didn't run.

- [ ] **Step 4: Live verify the contract against prod (read-only, real key)**

Fetch the key from BWS at runtime (never paste it) and probe booking prod. Requires `BWS_ACCESS_TOKEN`
in the shell (set by `start.sh`/the pipeline; if absent, source it the same way). Uses the exact BWS
fetch the repo's `fetch_bws_secret` helper uses:

```bash
export APPBRAIN_BASE_URL="https://app-brain.devonwatkins.com"
export APPBRAIN_ACCESS_KEY="$(bws secret get 45eb083f-4b05-4251-924d-b46700e5a643 --output json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['value'])")"
curl -fsS -H "x-brain-key: $APPBRAIN_ACCESS_KEY" \
  "$APPBRAIN_BASE_URL/api/apps/resolve?coolify_app_uuid=hkw488ggssgcskk0ooc0ksk0" | python3 -m json.tool
unset APPBRAIN_ACCESS_KEY
```

Expected: `{ "github_repo": "AlobarQuest/booking-system", "name": "prod", "branch": "master", "url": … }`. Also confirm `coolify_app_uuid=yscogs0wggcgco8g4wwk0o0g` → `branch: "preview"`, and a bogus uuid → HTTP 404. This validates the shared-key assumption + the live contract. Do NOT paste the key value anywhere; the `unset` above clears it from the shell after.

- [ ] **Step 5: Commit `dist/`**

```bash
git add dist/
git commit -m "build: compile app-brain resolution into dist/"
```

- [ ] **Step 6: Push + open the PR**

```bash
git push -u origin feat/appbrain-repo-branch-resolution
```

Open a PR noting: (1) the FQDN/uuid-as-join-key decision and why (rolling deploys make `resource_name` ids ephemeral); (2) the deleted `resource_name` parse was a latent wrong-branch bug (booking → `main` vs real `master`); (3) the multi-LLM panel hardenings; (4) the optional app-brain `matched_by` producer follow-up; (5) shared-key-for-v1 decision via `BWS_APPBRAIN_SECRET_ID`.

---

## Notes for the executor

- **Read the spec first:** `docs/superpowers/specs/2026-06-26-appbrain-repo-branch-resolution-design.md`.
- Tasks 1-2 are independent and additive (no existing behavior changes). Task 3 is the breaking rework and depends on both. Tasks 4-5 depend on 3. Task 6 is independent. Task 7 is last.
- `console.info/warn/error` go to stderr — the CLI writes its report to stdout, so logs don't corrupt report output. They surface in the `drift-audit.sh` log file via the `>>"$LOG_FILE" 2>&1` redirect.
- Do NOT lowercase `github_repo` in the consumer — app-brain case-folds server-side; the repo is displayed verbatim (`AlobarQuest/booking-system`, capital A).
