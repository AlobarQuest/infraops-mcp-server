import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runSelfCheck, type SelfCheckConfig } from '../src/security-drift/self-check.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-selfcheck-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cfg(over: Partial<SelfCheckConfig> = {}): SelfCheckConfig {
  return {
    stateFiles: [],
    auditLog: path.join(dir, 'audit.jsonl'),
    hwmFile: path.join(dir, 'hwm.json'),
    sourceVerifiedFiles: [],
    integrityFiles: [],
    hashFile: path.join(dir, 'hashes.json'),
    now: '2026-06-15T03:00:00Z',
    ...over,
  };
}

describe('runSelfCheck', () => {
  it('flags a state file that is not 0600', () => {
    const f = path.join(dir, 'baseline.json');
    fs.writeFileSync(f, '{}');
    fs.chmodSync(f, 0o644);
    const findings = runSelfCheck(cfg({ stateFiles: [f] }));
    expect(findings.map((x) => x.check)).toContain('selfcheck.state_perms');
  });

  it('passes a 0600 state file', () => {
    const f = path.join(dir, 'baseline.json');
    fs.writeFileSync(f, '{}', { mode: 0o600 });
    fs.chmodSync(f, 0o600);
    expect(runSelfCheck(cfg({ stateFiles: [f] }))).toHaveLength(0);
  });

  it('flags an audit log that shrank vs the recorded high-water mark', () => {
    const audit = path.join(dir, 'audit.jsonl');
    fs.writeFileSync(audit, 'x'.repeat(100));
    runSelfCheck(cfg({ auditLog: audit })); // records hwm=100
    fs.writeFileSync(audit, 'x'.repeat(40)); // shrank → tamper
    const findings = runSelfCheck(cfg({ auditLog: audit }));
    expect(findings.map((x) => x.check)).toContain('auditlog.tampered');
  });

  it('does not flag an audit log that only grows', () => {
    const audit = path.join(dir, 'audit.jsonl');
    fs.writeFileSync(audit, 'x'.repeat(100));
    runSelfCheck(cfg({ auditLog: audit }));
    fs.writeFileSync(audit, 'x'.repeat(200));
    expect(runSelfCheck(cfg({ auditLog: audit }))).toHaveLength(0);
  });

  it('change-tracked config (allowlist) seeds on first sight then flags on change', () => {
    const conf = path.join(dir, 'security-fp-allowlist.txt');
    fs.writeFileSync(conf, '#original');
    expect(runSelfCheck(cfg({ integrityFiles: [conf] }))).toHaveLength(0); // seed
    fs.writeFileSync(conf, '#CHANGED');
    const findings = runSelfCheck(cfg({ integrityFiles: [conf] }));
    expect(findings.map((x) => x.check)).toContain('selfcheck.runner_integrity');
  });
});

describe('runSelfCheck — source-verified integrity', () => {
  function pair() {
    return {
      deployed: path.join(dir, 'bin-security-scan.sh'),
      source: path.join(dir, 'src-security-scan.sh'),
    };
  }

  it('is silent when the deployed scanner byte-matches its blessed source', () => {
    const { deployed, source } = pair();
    fs.writeFileSync(deployed, '#!/bin/bash\necho blessed\n');
    fs.writeFileSync(source, '#!/bin/bash\necho blessed\n');
    expect(runSelfCheck(cfg({ sourceVerifiedFiles: [{ deployed, source }] }))).toHaveLength(0);
  });

  it('flags runner_integrity when the deployed scanner differs from blessed source', () => {
    const { deployed, source } = pair();
    fs.writeFileSync(deployed, '#!/bin/bash\necho TAMPERED\n');
    fs.writeFileSync(source, '#!/bin/bash\necho blessed\n');
    const findings = runSelfCheck(cfg({ sourceVerifiedFiles: [{ deployed, source }] }));
    expect(findings.map((x) => x.check)).toContain('selfcheck.runner_integrity');
  });

  it('flags runner_source_unresolved when the blessed source is unreadable (fail loud, not open)', () => {
    const { deployed, source } = pair();
    fs.writeFileSync(deployed, '#!/bin/bash\necho blessed\n');
    // source intentionally not written → unreadable
    const findings = runSelfCheck(cfg({ sourceVerifiedFiles: [{ deployed, source }] }));
    expect(findings.map((x) => x.check)).toContain('selfcheck.runner_source_unresolved');
  });

  it('is silent when the deployed scanner does not exist yet (nothing to verify)', () => {
    const { deployed, source } = pair();
    fs.writeFileSync(source, '#!/bin/bash\necho blessed\n');
    // deployed intentionally not written
    expect(runSelfCheck(cfg({ sourceVerifiedFiles: [{ deployed, source }] }))).toHaveLength(0);
  });

  it('flags runner_source_unresolved when the deployed scanner is present but unreadable (fail loud, not a silent skip)', () => {
    // Real-world trigger: a deployed scanner left with bad perms by a botched deploy.
    // A directory deterministically yields a non-ENOENT read error (EISDIR) regardless of uid.
    const deployed = path.join(dir, 'bin-unreadable');
    const source = path.join(dir, 'src-security-scan.sh');
    fs.mkdirSync(deployed);
    fs.writeFileSync(source, '#!/bin/bash\necho blessed\n');
    const findings = runSelfCheck(cfg({ sourceVerifiedFiles: [{ deployed, source }] }));
    expect(findings.map((x) => x.check)).toContain('selfcheck.runner_source_unresolved');
  });
});
