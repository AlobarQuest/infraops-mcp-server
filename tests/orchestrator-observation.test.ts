import { describe, it, expect } from 'vitest';
import {
  buildInstanceFacts,
  buildObservation,
  buildObservations,
  canonicalJson,
  factDigest,
} from '../src/orchestrator/observation.js';
import type { DriftReport } from '../src/standards/report.js';

const BANNED_KEY_PARTS = [
  'api_key',
  'authorization',
  'bearer',
  'body',
  'credential',
  'instruction',
  'log',
  'password',
  'secret',
  'token',
];

function report(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    generated_at: '2026-07-27T07:00:07Z',
    instances: {
      prod: {
        ok: true,
        summary: {
          total_proposals: 1,
          by_risk: { safe: 1, caution: 0, destructive: 0 },
          by_kind: { remediation: 1, question: 0 },
        },
        proposals: [],
      },
      dev: {
        ok: true,
        summary: {
          total_proposals: 0,
          by_risk: { safe: 0, caution: 0, destructive: 0 },
          by_kind: { remediation: 0, question: 0 },
        },
        proposals: [],
      },
    },
    totals: {
      total_proposals: 1,
      by_risk: { safe: 1, caution: 0, destructive: 0 },
      by_kind: { remediation: 1, question: 0 },
      instances_ok: 2,
      instances_failed: 0,
    },
    delta: {
      new: [
        {
          instance: 'prod',
          identity: 'prod::coolify.enable_healthcheck::abc',
          description: 'd',
          risk: 'safe',
          reasoning: 'r',
        },
      ],
      resolved: [],
      unchanged: 0,
    },
    ...overrides,
  } as DriftReport;
}

describe('canonicalJson', () => {
  it('sorts object keys recursively and uses compact separators', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('factDigest', () => {
  it('is stable for equal facts regardless of key insertion order', () => {
    expect(factDigest({ a: 1, b: 2 })).toBe(factDigest({ b: 2, a: 1 }));
  });

  it('changes when any fact changes', () => {
    expect(factDigest({ a: 1 })).not.toBe(factDigest({ a: 2 }));
  });

  it('is 12 hex characters', () => {
    expect(factDigest({ a: 1 })).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('buildInstanceFacts', () => {
  it('lifts the per-instance summary and counts that instance-s delta items', () => {
    expect(buildInstanceFacts(report(), 'prod')).toEqual({
      report_date: '2026-07-27',
      instance: 'prod',
      instance_ok: true,
      total_proposals: 1,
      by_risk: { safe: 1, caution: 0, destructive: 0 },
      by_kind: { remediation: 1, question: 0 },
      delta_new: 1,
      delta_resolved: 0,
      read_error_count: 0,
    });
  });

  it('does not attribute another instance-s delta items', () => {
    expect(buildInstanceFacts(report(), 'dev')).toMatchObject({
      instance: 'dev',
      total_proposals: 0,
      delta_new: 0,
      delta_resolved: 0,
    });
  });

  it('emits a bounded fact set for an unreachable instance and never its error text', () => {
    const r = report({
      instances: {
        prod: { ok: false, error: 'connect ECONNREFUSED 10.0.0.1:8000 — secret in url' },
      },
    } as Partial<DriftReport>);
    const facts = buildInstanceFacts(r, 'prod');
    expect(facts).toEqual({
      report_date: '2026-07-27',
      instance: 'prod',
      instance_ok: false,
      read_error_count: 0,
    });
    expect(canonicalJson(facts)).not.toContain('ECONNREFUSED');
  });

  it('counts per-endpoint read errors without carrying their text', () => {
    const r = report({
      instances: {
        prod: {
          ok: true,
          summary: {
            total_proposals: 0,
            by_risk: { safe: 0, caution: 0, destructive: 0 },
            by_kind: { remediation: 0, question: 0 },
          },
          proposals: [],
          errors: ['GET /applications failed', 'GET /services failed'],
        },
      },
    } as Partial<DriftReport>);
    const facts = buildInstanceFacts(r, 'prod');
    expect(facts.read_error_count).toBe(2);
    expect(canonicalJson(facts)).not.toContain('/applications');
  });

  it('never produces a fact key containing a scanner-banned substring', () => {
    const facts = buildInstanceFacts(report(), 'prod');
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
          keys.push(k);
          walk(child);
        }
      }
    };
    walk(facts);
    for (const k of keys) {
      expect(k.length).toBeLessThanOrEqual(64);
      for (const banned of BANNED_KEY_PARTS) {
        expect(k.toLowerCase()).not.toContain(banned);
      }
    }
  });

  it('stays far inside the 4096-byte fact bound', () => {
    expect(Buffer.byteLength(canonicalJson(buildInstanceFacts(report(), 'prod')), 'utf8')).toBeLessThan(1024);
  });
});

describe('buildObservation', () => {
  it('builds the full command for a drifting instance', () => {
    const o = buildObservation(report(), 'prod')!;
    expect(o.source_system).toBe('drift_digest');
    expect(o.observation_type).toBe('drift');
    expect(o.trust_classification).toBe('monitor');
    expect(o.subject_type).toBe('service');
    expect(o.subject_reference).toBe('coolify:prod');
    expect(o.environment).toBe('production');
    expect(o.expected_version).toBe(0);
    expect(o.source_url).toBeNull();
    expect(o.payload_digest).toBeNull();
    expect(o.observed_at).toBe('2026-07-27T07:00:07Z');
    expect(o.idempotency_key).toBe('drift-digest:2026-07-27T07:00:07Z:prod');
    expect(o.idempotency_key.length).toBeLessThanOrEqual(200);
    expect(o.source_reference).toMatch(/^infra-drift:2026-07-27T07:00:07Z:prod:[0-9a-f]{12}$/);
    expect(o.summary.length).toBeLessThanOrEqual(512);
  });

  it('maps dev to the development environment', () => {
    const o = buildObservation(report(), 'dev')!;
    expect(o.subject_reference).toBe('coolify:dev');
    expect(o.environment).toBe('development');
  });

  it('is passed/info on a clean reachable instance', () => {
    const o = buildObservation(report(), 'dev')!;
    expect(o.status).toBe('passed');
    expect(o.severity).toBe('info');
  });

  it('is degraded/warning when proposals exist', () => {
    const o = buildObservation(report(), 'prod')!;
    expect(o.status).toBe('degraded');
    expect(o.severity).toBe('warning');
  });

  it('is critical when any destructive-risk proposal exists', () => {
    const r = report({
      instances: {
        prod: {
          ok: true,
          summary: {
            total_proposals: 2,
            by_risk: { safe: 1, caution: 0, destructive: 1 },
            by_kind: { remediation: 2, question: 0 },
          },
          proposals: [],
        },
      },
    } as Partial<DriftReport>);
    const o = buildObservation(r, 'prod')!;
    expect(o.status).toBe('degraded');
    expect(o.severity).toBe('critical');
  });

  it('is unknown/warning when the instance is unreachable', () => {
    const r = report({
      instances: { prod: { ok: false, error: 'boom' } },
    } as Partial<DriftReport>);
    const o = buildObservation(r, 'prod')!;
    expect(o.status).toBe('unknown');
    expect(o.severity).toBe('warning');
    expect(o.summary).toBe('coolify:prod — instance unreachable');
  });

  it('returns null for an instance with no subject mapping', () => {
    const r = report({ instances: { staging: { ok: true } } } as Partial<DriftReport>);
    expect(buildObservation(r, 'staging')).toBeNull();
  });

  it('varies the source_reference when facts change but generated_at does not', () => {
    const a = buildObservation(report(), 'prod')!;
    const changed = report({
      instances: {
        prod: {
          ok: true,
          summary: {
            total_proposals: 5,
            by_risk: { safe: 5, caution: 0, destructive: 0 },
            by_kind: { remediation: 5, question: 0 },
          },
          proposals: [],
        },
      },
    } as Partial<DriftReport>);
    expect(buildObservation(changed, 'prod')!.source_reference).not.toBe(a.source_reference);
  });

  it('varies the source_reference and idempotency_key when generated_at changes', () => {
    const a = buildObservation(report(), 'prod')!;
    const b = buildObservation(report({ generated_at: '2026-07-28T07:00:07Z' }), 'prod')!;
    expect(b.source_reference).not.toBe(a.source_reference);
    expect(b.idempotency_key).not.toBe(a.idempotency_key);
  });

  it('is byte-identical for the same report, so a re-post dedups', () => {
    expect(JSON.stringify(buildObservation(report(), 'prod'))).toBe(
      JSON.stringify(buildObservation(report(), 'prod')),
    );
  });
});

describe('buildObservations', () => {
  it('emits one command per audited instance', () => {
    const os = buildObservations(report());
    expect(os.map((o) => o.subject_reference).sort()).toEqual(['coolify:dev', 'coolify:prod']);
  });

  it('skips unmapped instances rather than throwing', () => {
    const r = report({
      instances: {
        prod: {
          ok: true,
          summary: {
            total_proposals: 0,
            by_risk: { safe: 0, caution: 0, destructive: 0 },
            by_kind: { remediation: 0, question: 0 },
          },
          proposals: [],
        },
        staging: { ok: true },
      },
    } as Partial<DriftReport>);
    expect(buildObservations(r)).toHaveLength(1);
  });
});
