import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

const { coolifyGet, coolifyPatch } = vi.hoisted(() => ({
  coolifyGet: vi.fn(),
  coolifyPatch: vi.fn(),
}));

vi.mock('../src/services/coolify-client.js', () => ({
  coolifyGet,
  coolifyPatch,
}));

import {
  wouldChange,
  isAutoApplicable,
  applyAction,
  maxAutoApplies,
  verifySafe,
  buildHealthProbeUrl,
} from '../src/standards/executor.js';
import type { Proposal } from '../src/standards/check-engine.js';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'coolify.enable_healthcheck:deadbeef',
    kind: 'remediation',
    source: 'standards-audit',
    status: 'pending',
    target: { provider: 'coolify', resource_type: 'application', uuid: 'u1', name: 'app1' },
    description: "App 'app1' violates standard",
    reasoning: 'infra-brain rule #570',
    confidence: 'high',
    risk: 'safe',
    planned_action: {
      tool: 'coolify_update_application',
      args: { uuid: 'u1', health_check_enabled: true },
    },
    question: null,
    ...overrides,
  };
}

describe('wouldChange', () => {
  it('returns true when a non-uuid arg differs from current state', () => {
    expect(
      wouldChange(
        { uuid: 'u1', health_check_enabled: false },
        { uuid: 'u1', health_check_enabled: true },
      ),
    ).toBe(true);
  });
  it('returns false when all non-uuid args already match (idempotent no-op)', () => {
    expect(
      wouldChange(
        { uuid: 'u1', health_check_enabled: true, extra: 'x' },
        { uuid: 'u1', health_check_enabled: true },
      ),
    ).toBe(false);
  });
  it('ignores the uuid field when comparing', () => {
    expect(
      wouldChange(
        { uuid: 'DIFFERENT', health_check_enabled: true },
        { uuid: 'u1', health_check_enabled: true },
      ),
    ).toBe(false);
  });
});

describe('isAutoApplicable', () => {
  it('accepts a safe, high-confidence remediation whose tool is whitelisted', () => {
    expect(isAutoApplicable(makeProposal())).toBe(true);
  });
  it('rejects caution risk', () => {
    expect(isAutoApplicable(makeProposal({ risk: 'caution' }))).toBe(false);
  });
  it('rejects destructive risk', () => {
    expect(isAutoApplicable(makeProposal({ risk: 'destructive' }))).toBe(false);
  });
  it('rejects non-high confidence', () => {
    expect(isAutoApplicable(makeProposal({ confidence: 'medium' }))).toBe(false);
  });
  it('rejects kind=question', () => {
    expect(isAutoApplicable(makeProposal({ kind: 'question', planned_action: null }))).toBe(false);
  });
  it('rejects a null planned_action', () => {
    expect(isAutoApplicable(makeProposal({ planned_action: null }))).toBe(false);
  });
  it('rejects a tool that is not in SAFE_TOOLS', () => {
    expect(
      isAutoApplicable(
        makeProposal({
          planned_action: { tool: 'coolify_delete_application', args: { uuid: 'u1' } },
        }),
      ),
    ).toBe(false);
  });
});

describe('applyAction', () => {
  beforeEach(() => {
    coolifyGet.mockReset();
    coolifyPatch.mockReset();
  });

  it('applies a drifted safe remediation: one PATCH with the args minus uuid', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', health_check_enabled: false });
    coolifyPatch.mockResolvedValue({});
    const res = await applyAction(makeProposal(), 'prod');
    expect(res.status).toBe('applied');
    expect(coolifyPatch).toHaveBeenCalledTimes(1);
    expect(coolifyPatch).toHaveBeenCalledWith(
      '/applications/u1',
      { health_check_enabled: true },
      'prod',
    );
  });

  it('skips (no PATCH) when the resource already conforms — idempotent', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', health_check_enabled: true });
    const res = await applyAction(makeProposal(), 'prod');
    expect(res.status).toBe('skipped');
    expect(coolifyPatch).not.toHaveBeenCalled();
  });

  it('dry-run previews without PATCHing even when drifted', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', health_check_enabled: false });
    const res = await applyAction(makeProposal(), 'prod', { dryRun: true });
    expect(res.status).toBe('skipped');
    expect(res.detail).toMatch(/dry-run/i);
    expect(coolifyPatch).not.toHaveBeenCalled();
  });

  it('records failed (no throw) when the client errors, leaving the batch to continue', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', health_check_enabled: false });
    coolifyPatch.mockRejectedValue(new Error('boom'));
    const res = await applyAction(makeProposal(), 'prod');
    expect(res.status).toBe('failed');
    expect(res.detail).toContain('boom');
  });

  it('refuses (failed, no fetch) a non-auto-applicable proposal as defense in depth', async () => {
    const res = await applyAction(makeProposal({ risk: 'destructive' }), 'prod');
    expect(res.status).toBe('failed');
    expect(coolifyGet).not.toHaveBeenCalled();
    expect(coolifyPatch).not.toHaveBeenCalled();
  });
});

describe('maxAutoApplies', () => {
  const orig = process.env.MAX_AUTO_APPLIES;
  beforeEach(() => {
    delete process.env.MAX_AUTO_APPLIES;
  });
  afterAll(() => {
    if (orig !== undefined) process.env.MAX_AUTO_APPLIES = orig;
  });

  it('defaults to 20', () => {
    expect(maxAutoApplies()).toBe(20);
  });
  it('reads a positive integer from env', () => {
    process.env.MAX_AUTO_APPLIES = '5';
    expect(maxAutoApplies()).toBe(5);
  });
  it('falls back to 20 on a non-numeric env value', () => {
    process.env.MAX_AUTO_APPLIES = 'nonsense';
    expect(maxAutoApplies()).toBe(20);
  });
});

describe('buildHealthProbeUrl', () => {
  it('normalizes a bare fqdn to https + path', () => {
    expect(buildHealthProbeUrl('app.devonwatkins.com', '/api/health')).toBe(
      'https://app.devonwatkins.com/api/health',
    );
  });
  it('keeps an existing scheme and takes the first of multiple comma-separated fqdns', () => {
    expect(buildHealthProbeUrl('https://a.x.com,https://b.x.com', '/health/ready')).toBe(
      'https://a.x.com/health/ready',
    );
  });
  it('strips a trailing slash on the fqdn before appending the path', () => {
    expect(buildHealthProbeUrl('https://app.x.com/', '/api/health')).toBe(
      'https://app.x.com/api/health',
    );
  });
  it('returns null when there is no fqdn', () => {
    expect(buildHealthProbeUrl('', '/api/health')).toBeNull();
    expect(buildHealthProbeUrl(null, '/api/health')).toBeNull();
    expect(buildHealthProbeUrl(undefined, '/api/health')).toBeNull();
  });
});

describe('verifySafe (probe-guarded enable_healthcheck)', () => {
  beforeEach(() => {
    coolifyGet.mockReset();
  });

  // The gate now probes the PUBLIC health path the remediation will set, rather than
  // requiring running:healthy (impossible before a check exists — the chicken-and-egg bug).
  const hcProposal = (
    args: Record<string, unknown> = {
      uuid: 'u1',
      health_check_enabled: true,
      health_check_path: '/api/health',
    },
  ) => makeProposal({ planned_action: { tool: 'coolify_update_application', args } });

  it('passes when the public health path probes 2xx (safe to auto-enable)', async () => {
    coolifyGet.mockResolvedValue({
      uuid: 'u1',
      fqdn: 'https://app1.devonwatkins.com',
      build_pack: 'nixpacks',
    });
    const r = await verifySafe(hcProposal(), 'prod', {
      probe: async () => ({ status: 200, reason: 'HTTP 200' }),
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toContain('200');
  });

  it("probes the EXACT path the remediation will set (so probe and config can't disagree)", async () => {
    coolifyGet.mockResolvedValue({
      uuid: 'u1',
      fqdn: 'https://svc.devonwatkins.com',
      build_pack: 'dockercompose',
    });
    let probed = '';
    const r = await verifySafe(
      hcProposal({ uuid: 'u1', health_check_enabled: true, health_check_path: '/health/ready' }),
      'prod',
      {
        probe: async (url) => {
          probed = url;
          return { status: 204, reason: 'HTTP 204' };
        },
      },
    );
    expect(probed).toBe('https://svc.devonwatkins.com/health/ready');
    expect(r.ok).toBe(true);
  });

  it('fails (→ escalate) on a redirect / SSO-protected app (non-2xx)', async () => {
    coolifyGet.mockResolvedValue({
      uuid: 'u1',
      fqdn: 'https://protected.devonwatkins.com',
      build_pack: 'nixpacks',
    });
    const r = await verifySafe(hcProposal(), 'prod', {
      probe: async () => ({ status: 302, reason: 'redirect' }),
    });
    expect(r.ok).toBe(false);
  });

  it("fails (→ escalate) on a network error when the internal probe also can't confirm 2xx", async () => {
    coolifyGet.mockResolvedValue({
      uuid: 'u1',
      fqdn: 'https://down.devonwatkins.com',
      ports_exposes: '8000',
    });
    const r = await verifySafe(hcProposal(), 'prod', {
      probe: async () => ({ status: null, reason: 'AbortError' }),
      internalProbe: async () => ({ status: null, reason: 'no running container' }),
    });
    expect(r.ok).toBe(false);
  });

  it('fails (→ escalate) when the app has no FQDN, and never probes', async () => {
    coolifyGet.mockResolvedValue({ uuid: 'u1', fqdn: '' });
    let called = false;
    const r = await verifySafe(hcProposal(), 'prod', {
      probe: async () => {
        called = true;
        return { status: 200, reason: '' };
      },
    });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('does not gate a non-enable_healthcheck remediation (returns ok, no fetch)', async () => {
    const r = await verifySafe(makeProposal({ id: 'coolify.something_else:abc123' }), 'prod');
    expect(r.ok).toBe(true);
    expect(coolifyGet).not.toHaveBeenCalled();
  });

  it('fails closed when the app fetch throws', async () => {
    coolifyGet.mockRejectedValue(new Error('boom'));
    const r = await verifySafe(hcProposal(), 'prod', {
      probe: async () => ({ status: 200, reason: '' }),
    });
    expect(r.ok).toBe(false);
  });
});
