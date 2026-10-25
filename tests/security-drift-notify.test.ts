import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SecurityEscalation } from '../src/security-drift/emit.js';
import { sendUrgentAlert, sendUrgentEmail } from '../src/security-drift/notify.js';

const HUB_TOKEN = 'hub-secret-token-do-not-log';
const RESEND_KEY = 're_resend_secret_do_not_log';
const CUT_MARKER = '… (cut; full list at https://change-mgr.alobar.net)';

const esc = (id: string): SecurityEscalation =>
  ({
    proposal_id: id,
    instance: 'mac',
    target: { provider: 'security', resource_type: 'x', uuid: id, name: `name-${id}` },
    risk: 'high',
    kind: 'question',
    reasoning: '[URGENT] something',
    plan: { remediation: { manual: ['do it'] }, blind_spots: 'blind' },
    urgent: true,
  }) as unknown as SecurityEscalation;

type Call = { url: string; init: RequestInit };

function recorder(statuses: Record<string, number>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const status = url.includes('alobar.net') ? (statuses.hub ?? 202) : (statuses.resend ?? 200);
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const baseDeps = { from: 'a@b.c', to: 'd@e.f' };
const hubBody = (c: Call) => JSON.parse(c.init.body as string);

describe('sendUrgentAlert', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const m of ['log', 'warn', 'error', 'info'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends one critical alert to the hub and no Resend call when a hub token is set', async () => {
    const { calls, fetchImpl } = recorder({});
    const ok = await sendUrgentAlert('k1', 'Title', 'Body', {
      ...baseDeps,
      hubToken: HUB_TOKEN,
      resendApiKey: RESEND_KEY,
      fetchImpl,
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://alerts.alobar.net/v1/alerts');
    expect(hubBody(calls[0])).toEqual({
      key: 'k1',
      severity: 'critical',
      status: 'firing',
      title: 'Title',
      message: 'Body',
    });
  });

  it('falls back to Resend when the hub answers 500', async () => {
    const { calls, fetchImpl } = recorder({ hub: 500 });
    const ok = await sendUrgentAlert('k1', 'Title', 'Body', {
      ...baseDeps,
      hubToken: HUB_TOKEN,
      resendApiKey: RESEND_KEY,
      fetchImpl,
    });
    expect(ok).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([
      'https://alerts.alobar.net/v1/alerts',
      'https://api.resend.com/emails',
    ]);
    expect(JSON.parse(calls[1].init.body as string).subject).toBe('Title');
  });

  it('uses only Resend when there is no hub token', async () => {
    const { calls, fetchImpl } = recorder({});
    const ok = await sendUrgentAlert('k1', 'Title', 'Body', {
      ...baseDeps,
      resendApiKey: RESEND_KEY,
      fetchImpl,
    });
    expect(ok).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(['https://api.resend.com/emails']);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      from: 'a@b.c',
      to: ['d@e.f'],
      subject: 'Title',
      text: 'Body',
    });
  });

  it('cuts a 6000-character body to at most 4000 characters ending in the pointer', async () => {
    const { calls, fetchImpl } = recorder({});
    await sendUrgentAlert('k1', 'Title', 'x'.repeat(6000), {
      ...baseDeps,
      hubToken: HUB_TOKEN,
      fetchImpl,
    });
    const message: string = hubBody(calls[0]).message;
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message.endsWith(CUT_MARKER)).toBe(true);
  });

  it('leaves a body of exactly 4000 characters whole', async () => {
    const { calls, fetchImpl } = recorder({});
    await sendUrgentAlert('k1', 'Title', 'y'.repeat(4000), {
      ...baseDeps,
      hubToken: HUB_TOKEN,
      fetchImpl,
    });
    expect(hubBody(calls[0]).message).toBe('y'.repeat(4000));
  });

  it('never writes either token to the console', async () => {
    const { fetchImpl } = recorder({ hub: 500, resend: 500 });
    await sendUrgentAlert('k1', 'Title', 'Body', {
      ...baseDeps,
      hubToken: HUB_TOKEN,
      resendApiKey: RESEND_KEY,
      fetchImpl,
    });
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n');
    expect(all).not.toContain(HUB_TOKEN);
    expect(all).not.toContain(RESEND_KEY);
  });

  it('sends nothing and returns false with neither token', async () => {
    const { calls, fetchImpl } = recorder({});
    expect(await sendUrgentAlert('k', 'T', 'B', { ...baseDeps, fetchImpl })).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('sendUrgentEmail keys', () => {
  afterEach(() => vi.useRealTimers());

  async function keyFor(ids: string[], key?: string): Promise<string> {
    const { calls, fetchImpl } = recorder({});
    await sendUrgentEmail(ids.map(esc), { ...baseDeps, hubToken: HUB_TOKEN, fetchImpl }, key);
    return hubBody(calls[0]).key;
  }

  it('keys on the date and a hash of the sorted ids, independent of order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    const a = await keyFor(['id-a', 'id-b']);
    expect(a).toMatch(/^security-urgent:2026-10-25:[0-9a-f]{8}$/);
    expect(await keyFor(['id-b', 'id-a'])).toBe(a);
    expect(await keyFor(['id-a', 'id-c'])).not.toBe(a);
  });

  it('gives the same set a different key on a different date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    const a = await keyFor(['id-a']);
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    expect(await keyFor(['id-a'])).not.toBe(a);
  });

  it('uses the caller key when one is given', async () => {
    expect(await keyFor(['id-a'], 'security-drift-version-skew')).toBe(
      'security-drift-version-skew',
    );
  });

  it('sends nothing for an empty list', async () => {
    const { calls, fetchImpl } = recorder({});
    expect(await sendUrgentEmail([], { ...baseDeps, hubToken: HUB_TOKEN, fetchImpl })).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
