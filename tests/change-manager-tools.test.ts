import { vi, describe, it, expect, beforeEach } from 'vitest';

const { coolifyGet, coolifyPatch, coolifyPost } = vi.hoisted(() => ({
  coolifyGet: vi.fn(),
  coolifyPatch: vi.fn(),
  coolifyPost: vi.fn(),
}));

vi.mock('../src/services/coolify-client.js', () => ({ coolifyGet, coolifyPatch, coolifyPost }));

import { TOOLS, runTool, httpsConformant, revertRollback } from '../src/change-manager/tools.js';

beforeEach(() => {
  coolifyGet.mockReset();
  coolifyPatch.mockReset();
  coolifyPost.mockReset();
});

describe('curated tools', () => {
  it('exposes only the allowlisted tools', () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_application',
      'redeploy_application',
      'report_blocked',
      'report_done',
      'set_application_domains',
      'set_application_healthcheck',
    ]);
  });

  it('set_application_domains http->https captures rollback + PATCHes', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', fqdn: 'http://x.com', domains: 'http://x.com' });
    coolifyPatch.mockResolvedValue({});
    const ctx = { instance: 'prod' as const, rollback: {} as Record<string, unknown> };
    const out = await runTool(
      'set_application_domains',
      { uuid: 'u1', domains: 'https://x.com' },
      ctx,
    );
    expect(coolifyPatch).toHaveBeenCalledWith(
      '/applications/u1',
      { domains: 'https://x.com', force_domain_override: true },
      'prod',
    );
    expect(ctx.rollback.domains).toBe('http://x.com'); // original captured
    expect(out).toMatch(/updated/i);
  });

  it('set_application_healthcheck captures rollback + PATCHes the health fields', async () => {
    coolifyGet.mockResolvedValue({
      uuid: 'u1',
      health_check_enabled: false,
      health_check_path: null,
      health_check_port: null,
    });
    coolifyPatch.mockResolvedValue({});
    const ctx = { instance: 'prod' as const, rollback: {} as Record<string, unknown> };
    await runTool('set_application_healthcheck', { uuid: 'u1', path: '/health', port: 3000 }, ctx);
    expect(coolifyPatch).toHaveBeenCalledWith(
      '/applications/u1',
      { health_check_enabled: true, health_check_path: '/health', health_check_port: 3000 },
      'prod',
    );
    expect(ctx.rollback.health_check_enabled).toBe(false); // original captured
  });

  it('redeploy_application POSTs the canonical /deploy?uuid= full deploy (not /applications/{uuid}/deploy, which 404s)', async () => {
    coolifyPost.mockResolvedValue({});
    const ctx = { instance: 'prod' as const, rollback: {} };
    await runTool('redeploy_application', { uuid: 'u1' }, ctx);
    expect(coolifyPost).toHaveBeenCalledWith('/deploy?uuid=u1', undefined, 'prod');
  });

  it('an unknown tool throws (defense in depth)', async () => {
    await expect(runTool('rm_rf', {}, { instance: 'prod', rollback: {} })).rejects.toThrow(
      /unknown tool/i,
    );
  });

  it('set_application_domains rejects a non-https domain in the list', async () => {
    const ctx = { instance: 'prod' as const, rollback: {} };
    await expect(
      runTool(
        'set_application_domains',
        { uuid: 'u1', domains: 'https://x.com,http://y.com' },
        ctx,
      ),
    ).rejects.toThrow(/https/i);
    expect(coolifyPatch).not.toHaveBeenCalled();
  });

  it('set_application_healthcheck rejects a bad path or non-integer port', async () => {
    const ctx = { instance: 'prod' as const, rollback: {} };
    await expect(
      runTool('set_application_healthcheck', { uuid: 'u1', path: 'health', port: 3000 }, ctx),
    ).rejects.toThrow();
    await expect(
      runTool('set_application_healthcheck', { uuid: 'u1', path: '/health', port: 3.5 }, ctx),
    ).rejects.toThrow();
    expect(coolifyPatch).not.toHaveBeenCalled();
  });

  it('a control tool passed to runTool throws (handled by the agent loop, not runTool)', async () => {
    await expect(
      runTool('report_done', { summary: 'x' }, { instance: 'prod', rollback: {} }),
    ).rejects.toThrow(/control tool/i);
  });
});

describe('conformance helpers + revert', () => {
  it('httpsConformant: true only when every domain is https', () => {
    expect(httpsConformant({ domains: 'https://x.com' })).toBe(true);
    expect(httpsConformant({ domains: 'https://x.com,https://y.com' })).toBe(true);
    expect(httpsConformant({ domains: 'http://x.com' })).toBe(false);
    expect(httpsConformant({ domains: 'https://x.com,http://y.com' })).toBe(false);
    expect(httpsConformant({ fqdn: 'https://x.com' })).toBe(true);
    expect(httpsConformant({})).toBe(false);
  });

  it('revertRollback restores captured domains via force_domain_override', async () => {
    coolifyPatch.mockResolvedValue({});
    await revertRollback('u1', { domains: 'http://x.com' }, 'prod');
    expect(coolifyPatch).toHaveBeenCalledWith(
      '/applications/u1',
      { domains: 'http://x.com', force_domain_override: true },
      'prod',
    );
  });

  it('revertRollback restores captured health fields', async () => {
    coolifyPatch.mockResolvedValue({});
    await revertRollback(
      'u1',
      { health_check_enabled: false, health_check_path: null, health_check_port: null },
      'prod',
    );
    expect(coolifyPatch).toHaveBeenCalledWith(
      '/applications/u1',
      { health_check_enabled: false, health_check_path: null, health_check_port: null },
      'prod',
    );
  });

  it('revertRollback with an empty rollback is a no-op', async () => {
    await revertRollback('u1', {}, 'prod');
    expect(coolifyPatch).not.toHaveBeenCalled();
  });
});
