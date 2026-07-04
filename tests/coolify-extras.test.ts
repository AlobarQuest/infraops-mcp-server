import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as client from '../src/services/coolify-client.js';

const mockServer = {
  registerTool: vi.fn((name: string, schema: any, handler: any) => {
    mockServer._handlers[name] = handler;
    mockServer._schemas[name] = schema;
  }),
  _handlers: {} as Record<string, Function>,
  _schemas: {} as Record<string, any>,
};

vi.mock('../src/services/coolify-client.js', () => ({
  coolifyGet: vi.fn(),
  coolifyPost: vi.fn(),
  coolifyPatch: vi.fn(),
  coolifyDelete: vi.fn(),
  handleCoolifyError: vi.fn((e) => `Error: ${e?.message ?? e}`),
}));

import { registerDeploymentTools } from '../src/tools/deployments.js';
import { registerEnvVarTools } from '../src/tools/env-vars.js';

describe('coolify_cancel_deployment', () => {
  beforeEach(() => {
    mockServer._handlers = {};
    mockServer._schemas = {};
    vi.clearAllMocks();
    registerDeploymentTools(mockServer as any);
  });

  it('POSTs to /deployments/{uuid}/cancel', async () => {
    vi.mocked(client.coolifyPost).mockResolvedValueOnce({ message: 'cancelled' });
    await mockServer._handlers['coolify_cancel_deployment']({
      deployment_uuid: 'd1',
      instance: 'prod',
    });
    expect(client.coolifyPost).toHaveBeenCalledWith('/deployments/d1/cancel', undefined, 'prod');
  });

  it('requires an explicit instance', () => {
    expect(
      mockServer._schemas['coolify_cancel_deployment'].inputSchema.instance.safeParse(undefined)
        .success,
    ).toBe(false);
  });
});

describe('coolify_bulk_set_app_env', () => {
  beforeEach(() => {
    mockServer._handlers = {};
    mockServer._schemas = {};
    vi.clearAllMocks();
    registerEnvVarTools(mockServer as any);
  });

  it('upserts the key on each app and aggregates partial failures', async () => {
    vi.mocked(client.coolifyPatch)
      .mockResolvedValueOnce({} as any) // app1 ok
      .mockRejectedValueOnce(new Error('boom')); // app2 fails
    const res = await mockServer._handlers['coolify_bulk_set_app_env']({
      app_uuids: ['app1', 'app2'],
      key: 'SHARED',
      value: 'v',
      is_buildtime: false,
      is_runtime: true,
      instance: 'prod',
    });
    expect(client.coolifyPatch).toHaveBeenCalledWith(
      '/applications/app1/envs',
      { key: 'SHARED', value: 'v', is_buildtime: false, is_runtime: true },
      'prod',
    );
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
    expect(parsed.succeeded).toEqual([{ uuid: 'app1' }]);
    expect(parsed.failed[0].uuid).toBe('app2');
  });

  it('requires an explicit instance', () => {
    expect(
      mockServer._schemas['coolify_bulk_set_app_env'].inputSchema.instance.safeParse(undefined)
        .success,
    ).toBe(false);
  });
});
