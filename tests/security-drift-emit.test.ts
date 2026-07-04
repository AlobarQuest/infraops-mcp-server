import { describe, it, expect } from 'vitest';
import {
  buildEscalations,
  toEscalation,
  type ClassifiedFinding,
} from '../src/security-drift/emit.js';
import { classify } from '../src/security-drift/taxonomy.js';
import { planHash } from '../src/security-drift/canonical.js';
import type { Finding } from '../src/security-drift/scan-parser.js';

const cf = (check: string, target: string, detail: string): ClassifiedFinding => {
  const finding: Finding = { severity: 'FAIL', check, detail, target };
  const classification = classify(finding, { autoFixAllowlist: [] })!;
  return { finding, classification };
};

describe('toEscalation', () => {
  it('maps a URGENT shell secret to a manual question escalation', () => {
    const e = toEscalation(
      cf('shell.plaintext_secret', '/Users/x/.zshrc', '/Users/x/.zshrc: TOKEN=<inline value>'),
    );
    expect(e.proposal_id.startsWith('sec.shell.plaintext_secret:')).toBe(true);
    expect(e.kind).toBe('question');
    expect(e.urgent).toBe(true);
    expect('manual' in e.plan.remediation).toBe(true);
    expect(e.target.provider).toBe('security');
    expect(e.plan.source).toBe('security');
    expect(e.reasoning.startsWith('[URGENT]')).toBe(true);
  });

  it('maps a NORMAL os toggle to a remediation with an exact exec', () => {
    const e = toEscalation(
      cf('os.screen_lock', 'screen lock off', 'screen lock off (askForPassword=0)'),
    );
    expect(e.kind).toBe('remediation');
    expect(e.urgent).toBe(false);
    expect('exec' in e.plan.remediation && e.plan.remediation.exec[0][0]).toBe('defaults');
  });
});

describe('buildEscalations', () => {
  it('records a plan-hash keyed by fingerprint that matches planHash(plan)', () => {
    const item = cf(
      'shell.plaintext_secret',
      '/Users/x/.zshrc',
      '/Users/x/.zshrc: TOKEN=<inline value>',
    );
    const { escalations, hashes } = buildEscalations([item], '2026-06-15T03:00:00Z');
    const e = escalations[0];
    expect(hashes[e.target.uuid]).toBe(planHash(e.plan));
  });
});
