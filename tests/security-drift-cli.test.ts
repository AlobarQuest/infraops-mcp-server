import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { credScan, doRecordRotation, main, parseArgs } from '../src/cli/security-drift-cli.js';
import {
  CLASS_POLICY,
  loadRotationState,
  saveRotationState,
} from '../src/security-drift/cred-rotation.js';

const TOML = `version = 1
[[credential]]
id = "cred-a"
class = "openrouter-key"
[[credential]]
id = "cred-revoked"
class = "github-pat-classic"
disposition = "revoke-no-replacement"
`;

describe('security-drift-cli record-rotation', () => {
  let dir: string;
  let stateFile: string;
  let out: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-rotation-'));
    const toml = path.join(dir, 'reg.cred-consumers.toml');
    fs.writeFileSync(toml, TOML);
    fs.writeFileSync(path.join(dir, 'cred-consumers.list'), `${toml}\n`);
    process.env.INFRADRIFT_CONFIG_DIR = dir;
    process.env.SECURITY_DRIFT_STATE_DIR = dir;
    stateFile = path.join(dir, 'cred-rotation-state.json');
    saveRotationState(stateFile, {
      resolvedExposures: { 'cred-a:e1': { ts: '2026-01-01T00:00:00.000Z', detail: 'd' } },
      lastRotated: { 'cred-a': '2026-01-01T00:00:00.000Z' },
    });
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out += String(s);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (argv: string[]) => doRecordRotation(parseArgs(['record-rotation', ...argv]));

  it('sets lastRotated, keeps the rest of the state, stays 0600 and prints the change', () => {
    run(['--cred', 'cred-a', '--date', '2026-10-06']);
    const state = loadRotationState(stateFile);
    expect(state.lastRotated['cred-a']).toBe('2026-10-06T00:00:00.000Z');
    expect(state.resolvedExposures['cred-a:e1']).toBeDefined();
    expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp.'))).toEqual([]);
    expect(out).toContain(
      'recorded: cred-a lastRotated 2026-01-01T00:00:00.000Z -> 2026-10-06T00:00:00.000Z',
    );
  });

  it("accepts 'now'", () => {
    const before = Date.now();
    run(['--cred', 'cred-a', '--date', 'now']);
    const recorded = Date.parse(loadRotationState(stateFile).lastRotated['cred-a']);
    expect(recorded).toBeGreaterThanOrEqual(before);
    expect(recorded).toBeLessThanOrEqual(Date.now());
  });

  it('refuses an unknown credential id without writing', () => {
    const before = fs.readFileSync(stateFile, 'utf8');
    expect(() => run(['--cred', 'cred-nope', '--date', '2026-10-06'])).toThrow(
      /unknown credential id 'cred-nope'/,
    );
    expect(fs.readFileSync(stateFile, 'utf8')).toBe(before);
    expect(out).toBe('');
  });

  it('requires an explicit --date', () => {
    const before = fs.readFileSync(stateFile, 'utf8');
    expect(() => run(['--cred', 'cred-a'])).toThrow(/requires --cred <id> and --date/);
    expect(() => run(['--cred', 'cred-a', '--date'])).toThrow(/requires --cred <id> and --date/);
    expect(fs.readFileSync(stateFile, 'utf8')).toBe(before);
  });

  it.each([['2026'], ['2026-02-30'], ['10/07/2026'], ['2099-01-01']])(
    'refuses --date %s without writing',
    (date) => {
      const before = fs.readFileSync(stateFile, 'utf8');
      expect(() => run(['--cred', 'cred-a', '--date', date])).toThrow(/invalid date|future/);
      expect(fs.readFileSync(stateFile, 'utf8')).toBe(before);
    },
  );

  it('refuses a revoke-no-replacement credential without writing', () => {
    const before = fs.readFileSync(stateFile, 'utf8');
    expect(() => run(['--cred', 'cred-revoked', '--date', 'now'])).toThrow(
      /recorded by the rotation executor/,
    );
    expect(fs.readFileSync(stateFile, 'utf8')).toBe(before);
  });

  it('requires --cred', () => {
    expect(() => run(['--date', 'now'])).toThrow(/requires --cred <id> and --date/);
  });

  it('is dispatched from the CLI entrypoint', async () => {
    await main(['record-rotation', '--cred', 'cred-a', '--date', '2026-10-06']);
    expect(loadRotationState(stateFile).lastRotated['cred-a']).toBe('2026-10-06T00:00:00.000Z');
  });

  it('creates the state file when none exists', () => {
    fs.rmSync(stateFile);
    run(['--cred', 'cred-a', '--date', '2026-10-06']);
    expect(loadRotationState(stateFile).lastRotated).toEqual({
      'cred-a': '2026-10-06T00:00:00.000Z',
    });
    expect(out).toContain('lastRotated (none) ->');
  });
});

describe('security-drift-cli cred-findings', () => {
  const REGISTRY = `version = 1
[[credential]]
id = "cred-age"
class = "openrouter-key"
created = "2025-01-02"
[[credential]]
id = "cred-requested"
class = "openai-key"
created = "2026-09-01"
rotate_requested = "2026-10-07"
[[credential]]
id = "cred-exposed"
class = "github-pat-classic"
created = "2026-09-01"
  [[credential.exposure]]
  id = "transcript-1"
  date = "2026-09-02"
  source = "a transcript"
[[credential]]
id = "cred-fresh"
class = "openai-key"
created = "2026-09-01"
[[credential]]
id = "cred-odd"
class = "mystery"
`;
  let dir: string;
  let stateFile: string;
  let out: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-findings-'));
    const toml = path.join(dir, 'reg.cred-consumers.toml');
    fs.writeFileSync(toml, REGISTRY);
    fs.writeFileSync(path.join(dir, 'cred-consumers.list'), `${toml}\n`);
    process.env.INFRADRIFT_CONFIG_DIR = dir;
    process.env.SECURITY_DRIFT_STATE_DIR = dir;
    stateFile = path.join(dir, 'cred-rotation-state.json');
    saveRotationState(stateFile, { resolvedExposures: {}, lastRotated: {} });
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out += String(s);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prints each rotation finding as its check plus structured facts, never the detail', async () => {
    await main(['cred-findings', '--now', '2026-10-07T12:00:00.000Z']);
    const document = JSON.parse(out);
    expect(document.schema_version).toBe(1);
    expect(document.findings).toEqual([
      {
        check: 'cred.rotation-age',
        id: 'cred-age',
        class: 'openrouter-key',
        anchor: '2025-01-02',
        rotated_by_sds: false,
      },
      {
        check: 'cred.rotation-requested',
        id: 'cred-requested',
        class: 'openai-key',
        rotate_requested: '2026-10-07',
        rotated_by_sds: false,
      },
      {
        check: 'cred.exposure-rotate',
        id: 'cred-exposed',
        class: 'github-pat-classic',
        exposure_id: 'transcript-1',
        exposure_date: '2026-09-02',
        rotated_by_sds: false,
      },
      { check: 'cred.unknown-class', id: 'cred-odd', class: 'mystery', rotated_by_sds: false },
    ]);
    expect(out).not.toContain('rotate now');
    expect(out).not.toContain('a transcript');
  });

  it('dates an age finding by the last recorded rotation, not by the clock', async () => {
    saveRotationState(stateFile, {
      resolvedExposures: {},
      lastRotated: { 'cred-age': '2025-03-04T05:06:07.000Z' },
    });
    await main(['cred-findings', '--now', '2026-10-07T12:00:00.000Z']);
    const age = JSON.parse(out).findings.find((f: { id: string }) => f.id === 'cred-age');
    expect(age.anchor).toBe('2025-03-04T05:06:07.000Z');
  });

  it('refuses rather than report nothing due when the registry list is missing', async () => {
    fs.rmSync(path.join(dir, 'cred-consumers.list'));
    await expect(main(['cred-findings'])).rejects.toThrow(/no registry files listed/);
    expect(out).toBe('');
  });

  it('refuses rather than report nothing due when the registry list names no file', async () => {
    fs.writeFileSync(path.join(dir, 'cred-consumers.list'), '# none\n');
    await expect(main(['cred-findings'])).rejects.toThrow(/no registry files listed/);
    expect(out).toBe('');
  });

  it('refuses rather than resurrect resolved exposures when the state file is missing', async () => {
    fs.rmSync(stateFile);
    await expect(main(['cred-findings'])).rejects.toThrow(/no rotation state/);
    expect(out).toBe('');
  });

  it('writes nothing', async () => {
    const before = fs.readFileSync(stateFile, 'utf8');
    const listing = fs.readdirSync(dir).sort();
    await main(['cred-findings']);
    expect(fs.readFileSync(stateFile, 'utf8')).toBe(before);
    expect(fs.readdirSync(dir).sort()).toEqual(listing);
  });

  it('refuses rather than answering an empty list when a registry does not parse', async () => {
    fs.writeFileSync(path.join(dir, 'reg.cred-consumers.toml'), 'not = [valid\n');
    await expect(main(['cred-findings'])).rejects.toThrow();
    expect(out).toBe('');
  });
});

describe('security-drift-cli credScan — what the 03:00 run posts', () => {
  it("leaves out an SDS credential's rotation trigger and keeps the legacy one's", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-scan-'));
    const toml = path.join(dir, 'r.cred-consumers.toml');
    fs.writeFileSync(
      toml,
      'version = 1\n[[credential]]\nid = "sds"\nclass = "openrouter-key"\n' +
        'rotate_requested = "2026-10-01"\nrotated_by_sds = true\n' +
        '[[credential]]\nid = "legacy"\nclass = "openrouter-key"\nrotate_requested = "2026-10-01"\n',
    );
    const list = path.join(dir, 'cred-consumers.list');
    fs.writeFileSync(list, `${toml}\n`);
    const state = path.join(dir, 'state.json');
    saveRotationState(state, { resolvedExposures: {}, lastRotated: {} });

    const { findings } = credScan(list, state, '2026-10-07T12:00:00.000Z');
    const ids = findings.map((f) => `${f.check}:${f.facts?.id}`);
    expect(ids).toContain('cred.rotation-requested:legacy');
    expect(ids).not.toContain('cred.rotation-requested:sds');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('security-drift-cli — the SDS handover flag', () => {
  let dir: string;
  let out: string;
  const savedEnv = { ...process.env };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handover-'));
    const toml = path.join(dir, 'r.cred-consumers.toml');
    fs.writeFileSync(
      toml,
      'version = 1\n[[credential]]\nid = "sds"\nclass = "openrouter-key"\n' +
        'created = "2026-01-02"\nrotate_requested = "2026-10-01"\nrotated_by_sds = true\n' +
        '[[credential]]\nid = "sds-dated"\nclass = "openrouter-key"\ncreated = "2026-01-03"\n' +
        'last_rotated = "2026-09-20"\nrotated_by_sds = true\n' +
        '[[credential]]\nid = "sds-created"\nclass = "openrouter-key"\n' +
        'created = "2026-05-01"\nrotated_by_sds = true\n' +
        '[[credential]]\nid = "legacy"\nclass = "openrouter-key"\nrotate_requested = "2026-10-01"\n',
    );
    fs.writeFileSync(path.join(dir, 'cred-consumers.list'), `${toml}\n`);
    saveRotationState(path.join(dir, 'cred-rotation-state.json'), {
      resolvedExposures: {},
      lastRotated: {},
    });
    process.env.INFRADRIFT_CONFIG_DIR = dir;
    process.env.SECURITY_DRIFT_STATE_DIR = dir;
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out += String(s);
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('cred-findings says, per finding, whether the SDS owns the credential', async () => {
    await main(['cred-findings', '--now', '2026-10-07T12:00:00.000Z']);
    const owned = Object.fromEntries(
      JSON.parse(out).findings.map((f: { id: string; rotated_by_sds: boolean }) => [
        f.id,
        f.rotated_by_sds,
      ]),
    );
    expect(owned).toEqual({ sds: true, legacy: false });
  });

  it('cred-findings serves the recorded rotation for handed-over rows only', async () => {
    saveRotationState(path.join(dir, 'cred-rotation-state.json'), {
      resolvedExposures: {},
      lastRotated: {
        sds: '2026-07-02T00:00:00.000Z',
        legacy: '2026-07-03T00:00:00.000Z',
        // A state entry the registry no longer lists is not a handed-over row.
        gone: '2026-07-04T00:00:00.000Z',
      },
    });
    await main(['cred-findings', '--now', '2026-10-07T12:00:00.000Z']);
    const document = JSON.parse(out);
    expect(document.schema_version).toBe(1);
    expect(document.last_rotated).toEqual({
      sds: '2026-07-02T00:00:00.000Z',
      'sds-dated': '2026-09-20',
      'sds-created': '2026-05-01',
    });
  });

  it('cred-findings serves the age anchor for a handed-over row with an empty state', async () => {
    await main(['cred-findings', '--now', '2026-10-07T12:00:00.000Z']);
    expect(JSON.parse(out).last_rotated).toEqual({
      sds: '2026-01-02',
      'sds-dated': '2026-09-20',
      'sds-created': '2026-05-01',
    });
  });

  it('cred-findings serves the anchor the age finding uses', async () => {
    fs.writeFileSync(
      path.join(dir, 'old.cred-consumers.toml'),
      'version = 1\n[[credential]]\nid = "sds-old"\nclass = "openrouter-key"\n' +
        'created = "2024-02-03"\nrotated_by_sds = true\n',
    );
    fs.appendFileSync(
      path.join(dir, 'cred-consumers.list'),
      `${path.join(dir, 'old.cred-consumers.toml')}\n`,
    );
    await main(['cred-findings', '--now', '2026-10-07T12:00:00.000Z']);
    const document = JSON.parse(out);
    const age = document.findings.find((f: { id: string }) => f.id === 'sds-old');
    expect(document.last_rotated['sds-old']).toBe(age.anchor);
  });

  it('cred-findings answers the top-level shape the shared fixture pins', async () => {
    await main(['cred-findings', '--now', '2026-10-07T12:00:00.000Z']);
    const fixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures', 'rotation_findings.json'), 'utf8'),
    );
    expect(Object.keys(JSON.parse(out)).sort()).toEqual(Object.keys(fixture).sort());
  });

  it('the 03:00 scan builds no rotation plan for an SDS credential', () => {
    const { classifications } = credScan(
      path.join(dir, 'cred-consumers.list'),
      path.join(dir, 'cred-rotation-state.json'),
      '2026-10-07T12:00:00.000Z',
    );
    const keys = Object.keys(classifications ?? {});
    expect(keys.some((k) => k.endsWith('cred:legacy'))).toBe(true);
    expect(keys.some((k) => k.endsWith('cred:sds'))).toBe(false);
  });
});

// A byte-identical copy lives in the orchestrator, which holds its CLASS_TYPES to it.
describe('rotation_class_policy.json', () => {
  it('is CLASS_POLICY, so a new class fails here until the fixture moves', () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures', 'rotation_class_policy.json'), 'utf8'),
    );
    const generated = Object.fromEntries(
      Object.entries(CLASS_POLICY)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, policy]) => [name, { executor: policy.executor }]),
    );
    expect(fixture).toEqual(generated);
  });
});
