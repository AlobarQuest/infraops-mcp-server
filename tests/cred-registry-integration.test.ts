// Guards the real registry + the finding→plan join against silent drift:
// 1. the repo's own .cred-consumers.toml must parse under the strict-subset parser
//    (a syntax the parser rejects would otherwise surface only as a nightly
//    cred.registry-error, silencing every real rotation finding);
// 2. every finding credFindings() emits must route through classify() to its
//    registry-built classification — never the "unplanned" deny-by-default fallback
//    (the `${check}|${target}` join key is built in two places and must agree).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseCredConsumers } from '../src/security-drift/cred-consumers.js';
import { buildCredClassifications, credFindings } from '../src/security-drift/cred-rotation.js';
import { classify } from '../src/security-drift/taxonomy.js';

const REPO_TOML = path.join(__dirname, '..', '.cred-consumers.toml');

describe("the repo's own .cred-consumers.toml", () => {
  const specs = parseCredConsumers(fs.readFileSync(REPO_TOML, 'utf8'));

  const LEAKED = [
    'bitbucket-mirror-token',
    'github-classic-aihelper',
    'github-classic-lifeops',
    'github-finegrained-mirror',
    'openai-project',
    'openrouter-generic',
  ];
  const MACHINE_TOKENS = [
    'bws-cred-rotation-token',
    'bws-tok-brain-ops',
    'bws-tok-content-mini',
    'bws-tok-ops-mini-20260730',
  ];

  const API_KEYS = ['porkbun-api-keypair'];
  const DATABASE_PASSWORDS = ['alobar-id-postgres'];

  it('parses and carries the leaked-cred entries (sweep-attested) and the platform BWS machine tokens', () => {
    expect(specs.map((s) => s.id).sort()).toEqual(
      [...MACHINE_TOKENS, ...API_KEYS, ...DATABASE_PASSWORDS, ...LEAKED].sort(),
    );
    for (const s of specs.filter((x) => LEAKED.includes(x.id)))
      expect(s.consumers_verified, `${s.id} must be sweep-attested`).toBeTruthy();
  });

  it('ages the machine tokens from their created date and routes them to the manual checklist', () => {
    const state = { resolvedExposures: {}, lastRotated: {} };
    // The tokens still rotated by hand; one the SDS rotates (rotated_by_sds) is routed to the
    // orchestrator's rotation proposer instead.
    const tokens = specs.filter((s) => MACHINE_TOKENS.includes(s.id) && !s.rotated_by_sds);
    expect(tokens.length).toBeGreaterThan(0);
    for (const s of tokens) expect(s.created, `${s.id} needs an age anchor`).toBeTruthy();
    expect(credFindings(tokens, state, '2026-10-06T03:00:00Z')).toEqual([]);
    const later = credFindings(tokens, state, '2027-08-01T03:00:00Z');
    expect(later.map((f) => f.check)).toEqual(Array(tokens.length).fill('cred.rotation-age'));
    const cls = buildCredClassifications(tokens, state);
    for (const f of later) {
      const c = classify(f, { autoFixAllowlist: [], credClassifications: cls });
      expect(c!.remediation).toHaveProperty('manual');
    }
  });

  it('routes every emitted finding to its registry-built classification, never the unplanned fallback', () => {
    const state = { resolvedExposures: {}, lastRotated: {} };
    const findings = credFindings(specs, state, '2026-07-02T03:00:00Z');
    expect(findings.length).toBe(6); // one open exposure per credential
    const credClassifications = buildCredClassifications(specs, state);
    for (const f of findings) {
      const c = classify(f, { autoFixAllowlist: [], credClassifications });
      expect(c, `${f.target} must classify`).not.toBeNull();
      expect(c!.title).not.toMatch(/unplanned/);
    }
  });

  it('raises no age finding for the revoked classic PATs after their 180-day mark', () => {
    // Mirrors the live state: the executor confirmed both revokes on 2026-07-02 and
    // recorded the exposure resolved plus lastRotated in one write.
    const revoked = ['github-classic-aihelper', 'github-classic-lifeops'];
    const ts = '2026-07-02T22:49:52.254Z';
    const state = {
      resolvedExposures: Object.fromEntries(
        revoked.map((id) => [
          `${id}:codex-2026-07-02`,
          { ts, detail: 'revoke confirmed dead (401)' },
        ]),
      ),
      lastRotated: Object.fromEntries(revoked.map((id) => [id, ts])),
    };
    const pats = specs.filter((s) => revoked.includes(s.id));
    expect(pats.map((s) => s.disposition)).toEqual(Array(2).fill('revoke-no-replacement'));
    expect(credFindings(pats, state, '2026-12-30T03:00:00Z')).toEqual([]);
    expect(credFindings(pats, state, '2028-01-01T03:00:00Z')).toEqual([]);
  });

  it('yields executor-runnable plans for exactly the eligible creds (openrouter + the 2 BWS-held classic PATs)', () => {
    const state = { resolvedExposures: {}, lastRotated: {} };
    const cls = buildCredClassifications(specs, state);
    const kindOf = (id: string) => {
      const c = cls[`cred.exposure-rotate|cred:${id}`];
      return 'rotation' in c.remediation ? 'rotation' : 'manual';
    };
    expect(kindOf('openrouter-generic')).toBe('rotation');
    expect(kindOf('github-classic-aihelper')).toBe('rotation');
    expect(kindOf('github-classic-lifeops')).toBe('rotation');
    // The mirror fetches both tokens from BWS each cycle (runtime-fetch), a kind this executor
    // never deploys to; the orchestrator's rotation executor rotates them (ADR-0055 increment 7).
    expect(kindOf('github-finegrained-mirror')).toBe('manual');
    expect(kindOf('bitbucket-mirror-token')).toBe('manual');
    expect(kindOf('openai-project')).toBe('manual'); // no BWS copy to probe
  });
});
