import { describe, it, expect } from 'vitest';
import { runRemediation } from '../src/standards/run-remediation.js';
import type { AppResolution } from '../src/services/appbrain-client.js';

const hcProposal = (uuid: string) =>
  ({
    id: `coolify.enable_healthcheck:${uuid}`,
    kind: 'remediation',
    risk: 'safe',
    confidence: 'high',
    reasoning: 'health check missing',
    target: {
      provider: 'coolify',
      resource_type: 'application',
      uuid,
      name: 'alobar-quest/booking-system:main',
    },
    planned_action: {
      tool: 'coolify_update_application',
      args: { health_check_path: '/api/health' },
    },
  }) as any;

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

describe('runRemediation app-conformance classification', () => {
  it('404 hold → escalation carries lane + structured handoff + rendered brief', async () => {
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
          url: 'https://booking/api/health',
        }),
        resolve,
      ),
    );
    const e = report.escalations[0];
    expect(e.lane).toBe('app-conformance');
    expect(e.handoff?.repo).toBe('AlobarQuest/booking-system');
    expect(e.handoff?.target_branch).toBe('master');
    expect(e.handoff_brief).toContain('AlobarQuest/booking-system');
  });
  it('timeout hold → infra-config, no handoff/brief', async () => {
    const { report } = await runRemediation(
      ['prod'] as any,
      null,
      't',
      'r.json',
      baseDeps(async () => ({
        ok: false,
        reason: 'held',
        probe: { status: null, reason: 'AbortError' },
      })),
    );
    const e = report.escalations[0];
    expect(e.lane).toBe('infra-config');
    expect(e.handoff).toBeUndefined();
    expect(e.handoff_brief).toBeUndefined();
  });
});
