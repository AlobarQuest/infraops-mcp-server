import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { autoFix, runAutoFixes } from '../src/security-drift/autofix.js';

// These tests MUST exercise real filesystem primitives (O_NOFOLLOW / fchmod / nlink),
// so they operate on real files in a temp dir — no mocking.

let dir: string;
let rollbackLog: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-autofix-'));
  rollbackLog = path.join(dir, 'rollback.jsonl');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const mode = (p: string) => fs.lstatSync(p).mode & 0o777;

describe('autoFix guards', () => {
  it('chmods an allowlisted 0644 regular file to 0600 and records rollback', () => {
    const f = path.join(dir, '.env');
    fs.writeFileSync(f, 'SECRET=x', { mode: 0o644 });
    fs.chmodSync(f, 0o644);
    const r = autoFix(f, { allowlist: [f], rollbackLog });
    expect(r.status).toBe('applied');
    expect(mode(f)).toBe(0o600);
    const rec = JSON.parse(fs.readFileSync(rollbackLog, 'utf8').trim());
    expect(rec).toMatchObject({ path: f, priorMode: 0o644 });
    expect(rec.sha256).toHaveLength(64);
    expect((fs.statSync(rollbackLog).mode & 0o777).toString(8)).toBe('600');
  });

  it('BLOCKS a symlinked target and leaves the link target untouched', () => {
    const real = path.join(dir, 'real.key');
    fs.writeFileSync(real, 'K', { mode: 0o644 });
    fs.chmodSync(real, 0o644);
    const link = path.join(dir, 'link.key');
    fs.symlinkSync(real, link);
    const r = autoFix(link, { allowlist: [link], rollbackLog });
    expect(r.status).toBe('blocked');
    expect(r.status === 'blocked' && r.reason).toMatch(/symlink/);
    expect(mode(real)).toBe(0o644); // target NOT chmod'd
  });

  it('BLOCKS a hardlinked target', () => {
    const a = path.join(dir, 'a.env');
    fs.writeFileSync(a, 'X', { mode: 0o644 });
    fs.chmodSync(a, 0o644);
    const b = path.join(dir, 'b.env');
    fs.linkSync(a, b); // hardlink → nlink === 2
    const r = autoFix(b, { allowlist: [b], rollbackLog });
    expect(r.status).toBe('blocked');
    expect(r.status === 'blocked' && r.reason).toMatch(/hardlink/);
    expect(mode(a)).toBe(0o644);
  });

  it('BLOCKS a non-allowlisted path (deny-by-default) without touching it', () => {
    const f = path.join(dir, 'x.env');
    fs.writeFileSync(f, 'X', { mode: 0o644 });
    fs.chmodSync(f, 0o644);
    const r = autoFix(f, { allowlist: [], rollbackLog });
    expect(r.status).toBe('blocked');
    expect(mode(f)).toBe(0o644);
    expect(fs.existsSync(rollbackLog)).toBe(false); // never even opened
  });

  it('BLOCKS when the parent dir is other-writable', () => {
    const sub = path.join(dir, 'loose');
    fs.mkdirSync(sub, { mode: 0o777 });
    fs.chmodSync(sub, 0o777);
    const f = path.join(sub, '.env');
    fs.writeFileSync(f, 'X', { mode: 0o644 });
    fs.chmodSync(f, 0o644);
    const r = autoFix(f, { allowlist: [f], rollbackLog });
    expect(r.status).toBe('blocked');
    expect(r.status === 'blocked' && r.reason).toMatch(/parent/);
  });
});

describe('runAutoFixes cap', () => {
  it('applies up to the cap and blocks the rest', () => {
    const files = ['a', 'b', 'c'].map((n) => {
      const f = path.join(dir, `${n}.env`);
      fs.writeFileSync(f, 'X', { mode: 0o644 });
      fs.chmodSync(f, 0o644);
      return f;
    });
    const run = runAutoFixes(files, { allowlist: files, rollbackLog, cap: 2 });
    expect(run.applied).toHaveLength(2);
    expect(run.blocked).toHaveLength(1);
    expect(run.blocked[0].reason).toMatch(/cap/);
    expect(mode(files[2])).toBe(0o644); // the capped one untouched
  });
});
