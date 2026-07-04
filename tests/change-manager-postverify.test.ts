import { vi, describe, it, expect, beforeEach } from 'vitest';

const { coolifyGet, coolifyPatch, coolifyPost } = vi.hoisted(() => ({
  coolifyGet: vi.fn(),
  coolifyPatch: vi.fn(),
  coolifyPost: vi.fn(),
}));
vi.mock('../src/services/coolify-client.js', () => ({ coolifyGet, coolifyPatch, coolifyPost }));

import { postVerifyOrRevert, type PostVerifyDeps } from '../src/change-manager/agent.js';
import type { ApprovedItem } from '../src/change-manager/api-client.js';
import type { ToolCtx } from '../src/change-manager/tools.js';

beforeEach(() => {
  coolifyGet.mockReset();
  coolifyPatch.mockReset();
  coolifyPost.mockReset();
});

const item = (): ApprovedItem =>
  ({
    id: 1,
    rule_key: 'coolify.force_https',
    resource_uuid: 'u1',
    resource_name: 'app',
    instance: 'prod',
    risk: 'safe',
    kind: 'remediation',
    plan: {},
    source: 'drift',
  }) as unknown as ApprovedItem;

// A domains-change ctx: rollback.domains captured ⇒ post-verify runs the domains branch.
const domainsCtx = (): ToolCtx => ({
  instance: 'prod',
  rollback: { domains: 'http://x.com' },
  domainsChangedAt: 1000,
});

// Fast, network-free deps. Individual tests override deploymentSucceeded / httpsLive.
const deps = (over: Partial<PostVerifyDeps> = {}): PostVerifyDeps => ({
  deploymentSucceeded: vi.fn().mockResolvedValue('success'),
  httpsLive: vi.fn().mockResolvedValue(true),
  pollAttempts: 2,
  pollDelayMs: 0,
  sleep: () => Promise.resolve(),
  ...over,
});

const okCalls = () => [
  {
    name: 'set_application_domains',
    input: { uuid: 'u1', domains: 'https://x.com' },
    result: 'updated',
  },
  {
    name: 'redeploy_application',
    input: { uuid: 'u1' },
    result: 'redeploy (full deploy) triggered',
  },
  { name: 'report_done', input: { summary: 'done' }, result: 'done' },
];

describe('postVerifyOrRevert — deploy/cert depth (BACKLOG #5)', () => {
  it('config-not-https still reverts first (unchanged gate)', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', domains: 'http://x.com' }); // config never took
    coolifyPatch.mockResolvedValue({});
    const out = await postVerifyOrRevert(item(), domainsCtx(), okCalls(), deps());
    expect(out?.outcome).toBe('failed');
    expect(out?.detail).toMatch(/https/i);
    expect(coolifyPatch).toHaveBeenCalled(); // reverted
  });

  it('no redeploy call after a domain change → failed + revert', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', domains: 'https://x.com' });
    coolifyPatch.mockResolvedValue({});
    const calls = okCalls().filter((c) => c.name !== 'redeploy_application');
    const out = await postVerifyOrRevert(item(), domainsCtx(), calls, deps());
    expect(out?.outcome).toBe('failed');
    expect(out?.detail).toMatch(/redeploy/i);
    expect(coolifyPatch).toHaveBeenCalled();
  });

  it('redeploy call errored (the booking-preview 404) → failed + revert', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', domains: 'https://x.com' });
    coolifyPatch.mockResolvedValue({});
    const calls = okCalls();
    (calls.find((c) => c.name === 'redeploy_application') as Record<string, unknown>).is_error =
      true;
    const out = await postVerifyOrRevert(item(), domainsCtx(), calls, deps());
    expect(out?.outcome).toBe('failed');
    expect(out?.detail).toMatch(/redeploy/i);
    expect(coolifyPatch).toHaveBeenCalled();
  });

  it('redeploy ok but deployment status failed → failed + revert', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', domains: 'https://x.com' });
    coolifyPatch.mockResolvedValue({});
    const d = deps({ deploymentSucceeded: vi.fn().mockResolvedValue('failed') });
    const out = await postVerifyOrRevert(item(), domainsCtx(), okCalls(), d);
    expect(out?.outcome).toBe('failed');
    expect(out?.detail).toMatch(/deploy/i);
    expect(coolifyPatch).toHaveBeenCalled();
  });

  it('redeploy ok + deploy success + cert live → keep done (null)', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', domains: 'https://x.com', fqdn: 'https://x.com' });
    coolifyPatch.mockResolvedValue({});
    const out = await postVerifyOrRevert(item(), domainsCtx(), okCalls(), deps());
    expect(out).toBeNull();
    expect(coolifyPatch).not.toHaveBeenCalled(); // no revert
  });

  it('redeploy ok + deploy success + cert NOT live → failed + revert', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', domains: 'https://x.com', fqdn: 'https://x.com' });
    coolifyPatch.mockResolvedValue({});
    const d = deps({ httpsLive: vi.fn().mockResolvedValue(false) });
    const out = await postVerifyOrRevert(item(), domainsCtx(), okCalls(), d);
    expect(out?.outcome).toBe('failed');
    expect(out?.detail).toMatch(/cert/i);
    expect(coolifyPatch).toHaveBeenCalled();
  });

  it('deploy status inconclusive (pending/unknown) with a clean redeploy → keep done (no revert)', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', domains: 'https://x.com' });
    coolifyPatch.mockResolvedValue({});
    const d = deps({
      deploymentSucceeded: vi.fn().mockResolvedValue('unknown'),
      httpsLive: vi.fn(),
    });
    const out = await postVerifyOrRevert(item(), domainsCtx(), okCalls(), d);
    expect(out).toBeNull();
    expect(coolifyPatch).not.toHaveBeenCalled();
    expect(d.httpsLive).not.toHaveBeenCalled(); // no cert probe when deploy unconfirmed
  });

  it('health-only change: domains branch skipped, no deploy poll', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', health_check_enabled: true });
    const ctx: ToolCtx = { instance: 'prod', rollback: { health_check_enabled: false } };
    const d = deps();
    const out = await postVerifyOrRevert(item(), ctx, okCalls(), d);
    expect(out).toBeNull();
    expect(d.deploymentSucceeded).not.toHaveBeenCalled();
  });
});
