import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs, rotationRefusals } from '../src/cli/change-mgr-cli.js';

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

describe('rotationRefusals — the window interlock reads the live registry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sds-rot-'));
  const toml = path.join(dir, 'a.cred-consumers.toml');
  const list = path.join(dir, 'cred-consumers.list');
  fs.writeFileSync(
    toml,
    'version = 1\n[[credential]]\nid = "mine"\nclass = "openrouter-key"\nrotated_by_sds = true\n' +
      '[[credential]]\nid = "theirs"\nclass = "openrouter-key"\n',
  );

  it('refuses the credentials marked rotated_by_sds and allows the rest', () => {
    fs.writeFileSync(list, `${toml}\n`);
    const refuses = rotationRefusals(list);
    expect(refuses('mine')).toBe(true);
    expect(refuses('theirs')).toBe(false);
  });

  it('refuses a credential the registry does not hold, including a plan with no credId', () => {
    fs.writeFileSync(list, `${toml}\n`);
    expect(rotationRefusals(list)('nobody')).toBe(true);
    expect(rotationRefusals(list)('undefined')).toBe(true);
  });

  it('refuses every rotation when the list is missing', () => {
    expect(rotationRefusals(path.join(dir, 'absent.list'))('theirs')).toBe(true);
  });

  it('refuses every rotation when the list names no file', () => {
    fs.writeFileSync(list, '# nothing listed\n\n');
    expect(rotationRefusals(list)('theirs')).toBe(true);
  });

  it('refuses every rotation when a listed registry cannot be read', () => {
    fs.writeFileSync(list, `${path.join(dir, 'gone.toml')}\n`);
    expect(rotationRefusals(list)('theirs')).toBe(true);
  });
});
