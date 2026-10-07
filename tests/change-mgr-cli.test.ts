import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs, sdsRotatedCredentials } from '../src/cli/change-mgr-cli.js';

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
});

describe('sdsRotatedCredentials — the window interlock reads the live registry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sds-rot-'));
  const toml = path.join(dir, 'a.cred-consumers.toml');
  const list = path.join(dir, 'cred-consumers.list');
  fs.writeFileSync(
    toml,
    'version = 1\n[[credential]]\nid = "mine"\nclass = "openrouter-key"\nrotated_by_sds = true\n' +
      '[[credential]]\nid = "theirs"\nclass = "openrouter-key"\n',
  );

  it('names exactly the credentials marked rotated_by_sds', () => {
    fs.writeFileSync(list, `${toml}\n`);
    const owned = sdsRotatedCredentials(list);
    expect(owned('mine')).toBe(true);
    expect(owned('theirs')).toBe(false);
  });

  it('refuses every rotation when the list is missing', () => {
    expect(sdsRotatedCredentials(path.join(dir, 'absent.list'))('theirs')).toBe(true);
  });

  it('refuses every rotation when a listed registry cannot be read', () => {
    fs.writeFileSync(list, `${path.join(dir, 'gone.toml')}\n`);
    expect(sdsRotatedCredentials(list)('theirs')).toBe(true);
  });
});
