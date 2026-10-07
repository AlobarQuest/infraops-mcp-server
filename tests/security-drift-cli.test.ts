import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { doRecordRotation, main, parseArgs } from '../src/cli/security-drift-cli.js';
import { loadRotationState, saveRotationState } from '../src/security-drift/cred-rotation.js';

const TOML = `version = 1
[[credential]]
id = "cred-a"
class = "openrouter-key"
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
