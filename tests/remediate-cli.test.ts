import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli/remediate-cli.js';

describe('remediate-cli parseArgs', () => {
  it('parses value flags and boolean flags', () => {
    const a = parseArgs([
      '--instance',
      'prod,dev',
      '--report-dir',
      '/r',
      '--now',
      '2026-06-13T07:00:00Z',
      '--dry-run',
    ]);
    expect(a.instance).toBe('prod,dev');
    expect(a['report-dir']).toBe('/r');
    expect(a.now).toBe('2026-06-13T07:00:00Z');
    expect(a['dry-run']).toBe(true);
  });
  it('treats a trailing flag with no value as boolean true', () => {
    expect(parseArgs(['--stdout']).stdout).toBe(true);
  });
});
