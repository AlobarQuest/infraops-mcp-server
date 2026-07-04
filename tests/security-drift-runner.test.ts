import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runSecurityDrift, type RunnerConfig } from '../src/security-drift/runner.js';
import type { SyncBody } from '../src/change-manager/api-client.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-runner-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cfg(scanStdout: string, over: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    scanStdout,
    now: '2026-06-15T03:00:00Z',
    autoFixAllowlist: [],
    baselineFile: path.join(dir, 'baseline.json'),
    emitStateFile: path.join(dir, 'emit.json'),
    rollbackLog: path.join(dir, 'rollback.jsonl'),
    autoFixCap: 10,
    ...over,
  };
}

function deps() {
  const posted: SyncBody[] = [];
  const emailed: number[] = [];
  return {
    posted,
    emailed,
    d: {
      postSync: async (b: SyncBody) => {
        posted.push(b);
        return { new: 0, refreshed: 0, resolved: 0, reopened: 0 };
      },
      sendUrgent: async (items: any[]) => {
        emailed.push(items.length);
        return true;
      },
    },
  };
}

const SCAN = [
  '=== security-scan ===',
  'FAIL shell.plaintext_secret            /Users/x/.zshrc: TOKEN=<inline value>',
  'FAIL os.screen_lock                    screen lock off (askForPassword=0)',
  '=== summary ===',
].join('\n');

describe('runSecurityDrift', () => {
  it('seeds the baseline on first run and sends NO urgent email', async () => {
    const { posted, emailed, d } = deps();
    const r = await runSecurityDrift(cfg(SCAN), d);
    expect(r.seeded).toBe(true);
    expect(posted[0].source).toBe('security'); // full set still posted to CM
    expect(posted[0].escalations.length).toBe(2);
    expect(emailed).toHaveLength(0); // no email on the seed run
    expect(fs.existsSync(path.join(dir, 'baseline.json'))).toBe(true);
  });

  it('emails NEW urgent items on a subsequent run', async () => {
    // seed first
    await runSecurityDrift(cfg(SCAN), deps().d);
    // second run: a brand-new urgent finding appears
    const scan2 = SCAN + '\nFAIL mcp.inlined_secret                cfg.json: KEY has inline value';
    const { emailed, d } = deps();
    const r = await runSecurityDrift(cfg(scan2), d);
    expect(r.seeded).toBe(false);
    expect(r.urgentEmailed).toBe(1); // only the new mcp one
    expect(emailed).toEqual([1]);
  });

  it('auto-fixes an allowlisted cred file and keeps it out of the CM package', async () => {
    const cred = path.join(dir, '.env');
    fs.writeFileSync(cred, 'S=x', { mode: 0o644 });
    fs.chmodSync(cred, 0o644);
    const scan = `FAIL credfile.over_permissive          ${cred} (mode 644) group/other-readable`;
    const { posted, d } = deps();
    const r = await runSecurityDrift(cfg(scan, { autoFixAllowlist: [cred] }), d);
    expect(r.autoFixed).toHaveLength(1);
    expect((fs.statSync(cred).mode & 0o777).toString(8)).toBe('600');
    expect(posted[0].escalations).toHaveLength(0); // auto-fixed → not sent for approval
  });

  it('re-tiers a blocked (symlinked) auto-fix to an URGENT CM item', async () => {
    const real = path.join(dir, 'real.env');
    fs.writeFileSync(real, 'S', { mode: 0o644 });
    fs.chmodSync(real, 0o644);
    const link = path.join(dir, 'link.env');
    fs.symlinkSync(real, link);
    const scan = `FAIL credfile.over_permissive          ${link} (mode 644) group/other-readable`;
    const { posted, d } = deps();
    const r = await runSecurityDrift(cfg(scan, { autoFixAllowlist: [link] }), d);
    expect(r.autoFixBlocked).toHaveLength(1);
    expect(posted[0].escalations).toHaveLength(1); // blocked → escalated for human review
    const esc = posted[0].escalations[0] as any;
    expect(esc.urgent).toBe(true);
    expect(esc.reasoning).toMatch(/URGENT/);
    expect((fs.statSync(real).mode & 0o777).toString(8)).toBe('644'); // link target untouched
  });
});
