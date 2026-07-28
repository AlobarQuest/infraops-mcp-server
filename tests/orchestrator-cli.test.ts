import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseArgs, makeClient } from '../src/cli/orchestrator-cli.js';

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.ORCHESTRATOR_API_BASE;
  delete process.env.ORCHESTRATOR_M2M_TOKEN;
  delete process.env.ORCHESTRATOR_CREDENTIAL_KEY_ID;
});
afterEach(() => {
  process.env = { ...saved };
});

describe('orchestrator-cli parseArgs', () => {
  it('parses the subcommand and flags', () => {
    const a = parseArgs(['observe', '--report-dir', '/r', '--now', '2026-07-27T07:00:07Z']);
    expect(a.command).toBe('observe');
    expect(a['report-dir']).toBe('/r');
    expect(a.now).toBe('2026-07-27T07:00:07Z');
  });

  it('parses --dry-run as a boolean flag', () => {
    expect(parseArgs(['observe', '--dry-run'])['dry-run']).toBe(true);
  });
});

describe('orchestrator-cli makeClient', () => {
  it('throws when the base URL is missing', () => {
    process.env.ORCHESTRATOR_M2M_TOKEN = 'tok';
    expect(() => makeClient()).toThrow(/ORCHESTRATOR_API_BASE/);
  });

  it('throws when the token is missing', () => {
    process.env.ORCHESTRATOR_API_BASE = 'https://sds.example';
    expect(() => makeClient()).toThrow(/ORCHESTRATOR_M2M_TOKEN/);
  });

  it('builds a client when both are present', () => {
    process.env.ORCHESTRATOR_API_BASE = 'https://sds.example';
    process.env.ORCHESTRATOR_M2M_TOKEN = 'tok';
    expect(() => makeClient()).not.toThrow();
  });

  it('defaults the credential key id to orchestrator-drift-reporter', () => {
    process.env.ORCHESTRATOR_API_BASE = 'https://sds.example';
    process.env.ORCHESTRATOR_M2M_TOKEN = 'tok';
    const c = makeClient() as unknown as { credentialKeyId: string };
    expect(c.credentialKeyId).toBe('orchestrator-drift-reporter');
  });
});
