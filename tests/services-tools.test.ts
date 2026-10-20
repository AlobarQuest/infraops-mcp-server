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

import { registerServiceTools } from '../src/tools/services.js';

const kumaUrls = [{ name: 'uptime-kuma', url: 'http://kuma.local:3001' }];

beforeEach(() => {
  mockServer._handlers = {};
  mockServer._schemas = {};
  vi.clearAllMocks();
  registerServiceTools(mockServer as any);
});

describe('coolify_create_service', () => {
  const base = {
    project_uuid: 'p1',
    server_uuid: 's1',
    type: 'uptime-kuma',
    instance: 'dev',
  };

  it('uses the only environment and sends urls without domains or destination', async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce({ environments: [{ name: 'non-prod' }] });
    vi.mocked(client.coolifyPost).mockResolvedValueOnce({ uuid: 'svc' });
    const res = await mockServer._handlers['coolify_create_service']({ ...base, urls: kumaUrls });
    expect(res.isError).toBeUndefined();
    expect(client.coolifyGet).toHaveBeenCalledWith('/projects/p1', undefined, 'dev');
    expect(client.coolifyPost).toHaveBeenCalledWith(
      '/services',
      {
        project_uuid: 'p1',
        environment_name: 'non-prod',
        server_uuid: 's1',
        type: 'uptime-kuma',
        urls: kumaUrls,
      },
      'dev',
    );
  });

  it('requires environment_name when the project has several, listing them', async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce({
      environments: [{ name: 'production' }, { name: 'preview' }],
    });
    const res = await mockServer._handlers['coolify_create_service'](base);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('production, preview');
    expect(client.coolifyPost).not.toHaveBeenCalled();
  });

  it('rejects an unknown environment_name and lists the valid ones', async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce({ environments: [{ name: 'non-prod' }] });
    const res = await mockServer._handlers['coolify_create_service']({
      ...base,
      environment_name: 'production',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("'production' not found");
    expect(res.content[0].text).toContain('Valid: non-prod');
    expect(client.coolifyPost).not.toHaveBeenCalled();
  });

  it('passes an explicit destination_uuid through', async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce({ environments: [{ name: 'non-prod' }] });
    vi.mocked(client.coolifyPost).mockResolvedValueOnce({ uuid: 'svc' });
    await mockServer._handlers['coolify_create_service']({
      ...base,
      environment_name: 'non-prod',
      destination_uuid: 'd1',
    });
    expect(vi.mocked(client.coolifyPost).mock.calls[0][1]).toMatchObject({
      destination_uuid: 'd1',
    });
  });

  it('no longer accepts domains', () => {
    expect(mockServer._schemas['coolify_create_service'].inputSchema.domains).toBeUndefined();
  });
});

describe('coolify_update_service', () => {
  it('PATCHes urls as Coolify expects', async () => {
    vi.mocked(client.coolifyPatch).mockResolvedValueOnce({ uuid: 'svc' });
    await mockServer._handlers['coolify_update_service']({
      uuid: 'i12',
      urls: kumaUrls,
      instance: 'dev',
    });
    expect(client.coolifyPatch).toHaveBeenCalledWith('/services/i12', { urls: kumaUrls }, 'dev');
  });

  it('no longer accepts domains', () => {
    expect(mockServer._schemas['coolify_update_service'].inputSchema.domains).toBeUndefined();
  });
});
