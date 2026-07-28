import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseArgs,
  makeClient,
  formatSummaryLine,
  doObserve,
} from '../src/cli/orchestrator-cli.js';
import type { DriftReport } from '../src/standards/report.js';

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

describe('orchestrator-cli formatSummaryLine', () => {
  it('omits the skipped clause when nothing was skipped, keeping the common line unchanged', () => {
    expect(formatSummaryLine(2, 0, [], 2)).toBe('observations: posted=2 failed=0 of 2\n');
  });

  it('names skipped instances, counted, when present', () => {
    expect(formatSummaryLine(2, 0, ['staging'], 2)).toBe(
      'observations: posted=2 failed=0 skipped=1 (staging) of 2\n',
    );
  });
});

function prodSection(): DriftReport['instances'][string] {
  return {
    ok: true,
    summary: {
      total_proposals: 0,
      by_risk: { safe: 0, caution: 0, destructive: 0 },
      by_kind: { remediation: 0, question: 0 },
    },
    proposals: [],
  };
}

function cliReport(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    generated_at: '2026-07-27T07:00:07Z',
    instances: { prod: prodSection() },
    totals: {
      total_proposals: 0,
      by_risk: { safe: 0, caution: 0, destructive: 0 },
      by_kind: { remediation: 0, question: 0 },
      instances_ok: 1,
      instances_failed: 0,
    },
    delta: { new: [], resolved: [], unchanged: 0 },
    ...overrides,
  } as DriftReport;
}

function writeReport(dir: string, date: string, r: DriftReport): void {
  fs.writeFileSync(path.join(dir, `${date}.json`), JSON.stringify(r));
}

function captureStdout(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
    calls.push(String(chunk));
    return true;
  });
  return { calls, restore: () => spy.mockRestore() };
}

describe('orchestrator-cli doObserve', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-cli-test-'));
    process.exitCode = 0;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('counts a skipped (unmapped) instance in the dry-run summary line rather than dropping it', async () => {
    const r = cliReport({ instances: { prod: prodSection(), staging: { ok: true } } });
    writeReport(dir, '2026-07-27', r);
    const { calls, restore } = captureStdout();
    try {
      await doObserve(dir, '2026-07-27T07:00:07Z', true);
    } finally {
      restore();
    }
    expect(calls.at(-1)).toBe('observations: would post 1 skipped=1 (staging) (dry run)\n');
  });

  it('prints a WARN plus a failed-out counted summary when the client cannot be constructed', async () => {
    // ORCHESTRATOR_API_BASE / ORCHESTRATOR_M2M_TOKEN are unset (top-level beforeEach), so
    // makeClient() throws before the posting loop that normally prints the summary.
    writeReport(dir, '2026-07-27', cliReport());
    const { calls, restore } = captureStdout();
    try {
      await doObserve(dir, '2026-07-27T07:00:07Z', false);
    } finally {
      restore();
    }
    expect(calls[0]).toMatch(/^WARN: observation client unavailable:/);
    expect(calls.at(-1)).toBe('observations: posted=0 failed=1 of 1\n');
    expect(process.exitCode).toBe(1);
  });

  it('posts fail-open per instance and names a skipped instance in the real-post summary', async () => {
    process.env.ORCHESTRATOR_API_BASE = 'https://sds.example';
    process.env.ORCHESTRATOR_M2M_TOKEN = 'tok';
    const r = cliReport({ instances: { prod: prodSection(), staging: { ok: true } } });
    writeReport(dir, '2026-07-27', r);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'obs-1', recorded_by: 'drift-reconciler' }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    const { calls, restore } = captureStdout();
    try {
      await doObserve(dir, '2026-07-27T07:00:07Z', false);
    } finally {
      restore();
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)).toBe('observations: posted=1 failed=0 skipped=1 (staging) of 1\n');
    expect(process.exitCode).toBe(0);
  });

  it("is fail-open per instance: one rejected post never suppresses the other instance's row", async () => {
    process.env.ORCHESTRATOR_API_BASE = 'https://sds.example';
    process.env.ORCHESTRATOR_M2M_TOKEN = 'tok';
    const r = cliReport({ instances: { prod: prodSection(), dev: prodSection() } });
    writeReport(dir, '2026-07-27', r);
    // The queued once-behaviors below cover both of the two expected calls, so which instance
    // succeeds vs. fails does not matter -- only that exactly one of each happens.
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'obs-1', recorded_by: 'drift-reconciler' }),
      text: async () => '',
    });
    fetchMock.mockRejectedValueOnce(new Error('unreachable'));
    vi.stubGlobal('fetch', fetchMock);
    const { calls, restore } = captureStdout();
    try {
      await doObserve(dir, '2026-07-27T07:00:07Z', false);
    } finally {
      restore();
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      calls.some((c) => /^WARN: coolify:(prod|dev) observation failed: unreachable/.test(c)),
    ).toBe(true);
    expect(calls.at(-1)).toBe('observations: posted=1 failed=1 of 2\n');
    expect(process.exitCode).toBe(1);
  });
});
