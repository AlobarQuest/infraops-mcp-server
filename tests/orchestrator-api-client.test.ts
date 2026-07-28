import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrchestratorClient } from '../src/orchestrator/api-client.js';
import type { ObservationCommand } from '../src/orchestrator/observation.js';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown) {
  return { ok: true, status: 201, json: async () => body, text: async () => JSON.stringify(body) };
}

const command: ObservationCommand = {
  idempotency_key: 'drift-digest:2026-07-27T07:00:07Z:prod',
  expected_version: 0,
  source_system: 'drift_digest',
  source_reference: 'infra-drift:2026-07-27T07:00:07Z:prod:abcdef123456',
  source_url: null,
  trust_classification: 'monitor',
  subject_type: 'service',
  subject_reference: 'coolify:prod',
  environment: 'production',
  observation_type: 'drift',
  status: 'degraded',
  severity: 'warning',
  observed_at: '2026-07-27T07:00:07Z',
  summary: 'coolify:prod — 1 standards proposal (1 new)',
  facts: { instance: 'prod' },
  payload_digest: null,
};

describe('OrchestratorClient', () => {
  it('posts the command with BOTH M2M headers and returns the response', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'obs-1', recorded_by: 'drift-reconciler' }));
    const c = new OrchestratorClient('https://sds.example', 'tok', 'orchestrator-drift-reporter');

    const r = await c.postObservation(command);

    expect(r.recorded_by).toBe('drift-reconciler');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sds.example/api/v1/observations');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(opts.headers['X-Credential-Key-Id']).toBe('orchestrator-drift-reporter');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual(command);
  });

  it('sends an identifying User-Agent', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'obs-1' }));
    const c = new OrchestratorClient('https://sds.example', 'tok', 'k');
    await c.postObservation(command);
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toMatch(/infra-drift/);
  });

  it('strips a trailing slash from the base URL', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'obs-1' }));
    const c = new OrchestratorClient('https://sds.example/', 'tok', 'k');
    await c.postObservation(command);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sds.example/api/v1/observations');
  });

  it('throws with the status and a bounded body on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => 'observation_conflict',
    });
    const c = new OrchestratorClient('https://sds.example', 'tok', 'k');
    await expect(c.postObservation(command)).rejects.toThrow(/409.*observation_conflict/);
  });

  it('never puts the bearer token in the thrown message', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
    const c = new OrchestratorClient('https://sds.example', 'sup3r-s3cret', 'k');
    await expect(c.postObservation(command)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('sup3r-s3cret') }),
    );
  });
});
