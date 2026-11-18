import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  checkRunWindowFlags,
  doRunWindow,
  main,
  parseArgs,
  parseDryRun,
  parseInstance,
} from '../src/cli/change-mgr-cli.js';
import type { ApprovedItem } from '../src/change-manager/api-client.js';

describe('change-mgr-cli parseArgs', () => {
  it('parses the subcommand and flags', () => {
    const a = parseArgs(['run-window', '--report-dir', '/r', '--now', '2026-06-15T04:00:00Z']);
    expect(a.command).toBe('run-window');
    expect(a['report-dir']).toBe('/r');
    expect(a.now).toBe('2026-06-15T04:00:00Z');
  });
  it('captures sync as the command', () => {
    expect(parseArgs(['sync', '--report-dir', '/r']).command).toBe('sync');
  });
  it.each([
    [['run-window', '--dry-run', '--instance', 'prod']],
    [['run-window', '--instance', 'prod', '--dry-run']],
  ])('reads --dry-run and --instance in either order: %j', (argv) => {
    const a = parseArgs(argv);
    expect(a.command).toBe('run-window');
    expect(a['dry-run']).toBe(true);
    expect(a.instance).toBe('prod');
  });
});

describe('checkRunWindowFlags', () => {
  it("accepts the Mac wrapper's exact argument list, which still parses to the same values", () => {
    const argv = ['run-window', '--report-dir', '/r', '--now', '2026-11-18T04:00:00Z'];
    expect(() => checkRunWindowFlags(argv)).not.toThrow();
    expect(parseArgs(argv)).toEqual({
      command: 'run-window',
      'report-dir': '/r',
      now: '2026-11-18T04:00:00Z',
    });
  });
});

describe('parseInstance and parseDryRun', () => {
  it('accepts prod, dev, or absent', () => {
    expect(parseInstance('prod')).toBe('prod');
    expect(parseInstance('dev')).toBe('dev');
    expect(parseInstance(undefined)).toBeUndefined();
  });
  it('rejects any other value and a missing value', () => {
    expect(() => parseInstance('bogus')).toThrow(/--instance needs prod or dev/);
    expect(() => parseInstance(true)).toThrow(/--instance needs a value/);
  });
  it('treats --dry-run as a bare flag', () => {
    expect(parseDryRun(undefined)).toBe(false);
    expect(parseDryRun(true)).toBe(true);
    expect(() => parseDryRun('yes')).toThrow(/--dry-run takes no value/);
  });
});

function item(id: number, instance: string, source?: string): ApprovedItem {
  return {
    id,
    identity: `${instance}::coolify.force_https::u${id}`,
    instance,
    rule_key: 'coolify.force_https',
    resource_type: 'application',
    resource_uuid: `u${id}`,
    resource_name: `app${id}`,
    risk: 'caution',
    kind: 'remediation',
    reasoning: 'secret reasoning text',
    plan: {},
    note: null,
    status: 'approved',
    source,
  };
}

function fakeClient(items: ApprovedItem[]) {
  return {
    getApproved: vi.fn(async () => items),
    claim: vi.fn(async (id: number) => item(id, 'prod')),
    postOutcome: vi.fn(async () => ({})),
    startWindow: vi.fn(async () => ({ id: 7 })),
    finishWindow: vi.fn(async () => ({})),
  };
}

const done = vi.fn(async () => ({
  outcome: 'done' as const,
  detail: 'ok',
  rollback: {},
  tool_calls: { calls: [] },
}));

describe('doRunWindow', () => {
  let out: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.stubEnv('MAX_CHANGES_PER_WINDOW', '2');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('a dry run lists once, prints the selected ids, and changes nothing', async () => {
    const c = fakeClient([
      item(1, 'dev'),
      item(2, 'prod', 'security'),
      item(3, 'prod'),
      item(4, 'prod'),
      item(5, 'prod'),
    ]);
    const makeAgent = vi.fn(() => done);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-dry-'));
    await doRunWindow(c, makeAgent, {
      now: '2026-11-18T04:00:00Z',
      reportDir: dir,
      instance: 'prod',
      dryRun: true,
    });
    expect(c.getApproved).toHaveBeenCalledTimes(1);
    for (const m of [c.startWindow, c.claim, c.postOutcome, c.finishWindow, makeAgent]) {
      expect(m).not.toHaveBeenCalled();
    }
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(out.mock.calls).toEqual([['{"dry_run":true,"instance":"prod","would_claim":[3,4]}\n']]);
  });

  it('a dry run with no instance reports null and selects both instances', async () => {
    const c = fakeClient([item(1, 'dev'), item(2, 'prod'), item(3, 'prod')]);
    await doRunWindow(c, vi.fn(), { now: '2026-11-18T04:00:00Z', dryRun: true });
    expect(JSON.parse(String(out.mock.calls[0][0]))).toEqual({
      dry_run: true,
      instance: null,
      would_claim: [1, 2],
    });
  });

  it('a real run with --instance prod claims only prod items', async () => {
    const c = fakeClient([item(1, 'dev'), item(2, 'prod'), item(3, 'dev'), item(4, 'prod')]);
    await doRunWindow(c, () => done, {
      now: '2026-11-18T04:00:00Z',
      instance: 'prod',
      dryRun: false,
    });
    expect(c.startWindow).toHaveBeenCalledTimes(1);
    expect(c.claim.mock.calls).toEqual([[2], [4]]);
    expect(c.finishWindow).toHaveBeenCalledWith(7, expect.objectContaining({ considered: 2 }));
  });
});

describe('main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    [['run-window', '--instance', 'bogus']],
    [['run-window', '--dry-run', '--instance', 'bogus']],
    [['run-window', '--dry-run', '--instance']],
    [['run-window', '--instance', '--dry-run']],
  ])('rejects a bad or missing --instance before any network call: %j', async (argv) => {
    vi.stubEnv('CHANGE_MGR_API_BASE', 'https://cm.invalid');
    vi.stubEnv('CHANGE_MGR_M2M_TOKEN', 't');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(main(argv)).rejects.toThrow(/--instance needs/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [['run-window', '--instance=prod'], /take no "=": --instance=\.\.\.$/],
    [['run-window', '--dry-run=true'], /take no "=": --dry-run=\.\.\.$/],
    [['run-window', '--bogus'], /unknown run-window flag: --bogus/],
  ])('rejects %j before any network call', async (argv, message) => {
    vi.stubEnv('CHANGE_MGR_API_BASE', 'https://cm.invalid');
    vi.stubEnv('CHANGE_MGR_M2M_TOKEN', 't');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(main(argv)).rejects.toThrow(message);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
