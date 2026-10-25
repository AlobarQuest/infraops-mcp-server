import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SecurityEscalation } from '../src/security-drift/emit.js';
import {
  resolveVersionSkew,
  sendUrgentAlert,
  sendUrgentEmail,
  sendVersionSkewAlert,
} from '../src/security-drift/notify.js';

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
      kind: 'notice',
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

  it('cuts an alert body to 4000 characters ending in the pointer', async () => {
    const { calls, fetchImpl } = recorder({});
    await sendUrgentAlert(
      'k1',
      'Title',
      'x'.repeat(6000),
      { ...baseDeps, hubToken: HUB_TOKEN, fetchImpl },
      'alert',
    );
    const message: string = hubBody(calls[0]).message;
    expect(hubBody(calls[0]).kind).toBe('alert');
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message.endsWith(CUT_MARKER)).toBe(true);
  });

  it('lets a notice carry 12000 characters and cuts beyond that', async () => {
    const { calls, fetchImpl } = recorder({});
    const deps = { ...baseDeps, hubToken: HUB_TOKEN, fetchImpl };
    await sendUrgentAlert('k1', 'T', 'y'.repeat(12000), deps);
    expect(hubBody(calls[0]).message).toBe('y'.repeat(12000));
    await sendUrgentAlert('k1', 'T', 'x'.repeat(15000), deps);
    const message: string = hubBody(calls[1]).message;
    expect(message.length).toBeLessThanOrEqual(12000);
    expect(message.endsWith(CUT_MARKER)).toBe(true);
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

const NOW = '2026-10-25T12:00:00Z';

describe('sendUrgentEmail', () => {
  const send = async (ids: string[], now = NOW) => {
    const { calls, fetchImpl } = recorder({});
    await sendUrgentEmail(ids.map(esc), { ...baseDeps, hubToken: HUB_TOKEN, fetchImpl }, now);
    return calls;
  };

  it('sends a critical notice keyed on the run date from now', async () => {
    const [call] = await send(['id-a']);
    expect(hubBody(call)).toMatchObject({
      key: 'security-urgent:2026-10-25',
      kind: 'notice',
      severity: 'critical',
    });
    expect(hubBody((await send(['id-a'], '2026-11-02T03:00:00Z'))[0]).key).toBe(
      'security-urgent:2026-11-02',
    );
  });

  it('delivers two events on the same date, each as its own request', async () => {
    const first = await send(['id-a']);
    const second = await send(['id-b']);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(hubBody(second[0]).kind).toBe('notice');
  });

  it('sends nothing for an empty list', async () => {
    const { calls, fetchImpl } = recorder({});
    expect(await sendUrgentEmail([], { ...baseDeps, hubToken: HUB_TOKEN, fetchImpl }, NOW)).toBe(
      false,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('version skew state', () => {
  it('raises an alert under the fixed skew key', async () => {
    const { calls, fetchImpl } = recorder({});
    await sendVersionSkewAlert([esc('id-a')], { ...baseDeps, hubToken: HUB_TOKEN, fetchImpl });
    expect(hubBody(calls[0])).toMatchObject({
      key: 'security-drift-version-skew',
      kind: 'alert',
      severity: 'critical',
      status: 'firing',
    });
  });

  it('resolves the skew key through the hub only', async () => {
    const { calls, fetchImpl } = recorder({});
    await resolveVersionSkew({ ...baseDeps, hubToken: HUB_TOKEN, fetchImpl });
    expect(calls).toHaveLength(1);
    expect(hubBody(calls[0])).toMatchObject({
      key: 'security-drift-version-skew',
      status: 'resolved',
      severity: 'critical',
    });
    expect(hubBody(calls[0]).kind).toBe('alert');
  });

  it('does not resolve with no hub token and never uses Resend', async () => {
    const { calls, fetchImpl } = recorder({ hub: 500 });
    await resolveVersionSkew({ ...baseDeps, resendApiKey: RESEND_KEY, fetchImpl });
    expect(calls).toHaveLength(0);
    await resolveVersionSkew({
      ...baseDeps,
      hubToken: HUB_TOKEN,
      resendApiKey: RESEND_KEY,
      fetchImpl,
    });
    expect(calls.map((c) => c.url)).toEqual(['https://alerts.alobar.net/v1/alerts']);
  });
});
