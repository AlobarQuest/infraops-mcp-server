import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as client from '../src/services/coolify-client.js';

const mockServer = {
  registerTool: vi.fn((name, _schema, handler) => {
    mockServer._handlers[name] = handler;
  }),
  _handlers: {} as Record<string, Function>,
};

vi.mock('../src/services/coolify-client.js', () => ({
  coolifyGet: vi.fn(),
  coolifyPost: vi.fn(),
  coolifyPatch: vi.fn(),
  coolifyDelete: vi.fn(),
  handleCoolifyError: vi.fn((e) => `Error: ${e}`),
}));

import { registerServiceTools } from '../src/tools/services.js';

describe('coolify_update_service', () => {
  beforeEach(() => {
    mockServer._handlers = {};
    vi.mocked(client.coolifyPatch).mockResolvedValue({ uuid: 'svc-1' });
    registerServiceTools(mockServer as any);
  });

  it('base64-encodes docker_compose_raw before sending', async () => {
    const rawYaml = `version: "3"\nservices:\n  app:\n    image: nginx`;

    await mockServer._handlers['coolify_update_service']({
      uuid: 'svc-uuid-1',
      docker_compose_raw: rawYaml,
      instance: 'prod',
    });

    const callArgs = vi.mocked(client.coolifyPatch).mock.calls[0];
    const body = callArgs[1] as Record<string, unknown>;
    expect(body.docker_compose_raw).toBe(Buffer.from(rawYaml, 'utf8').toString('base64'));
  });

  it('does not encode other fields', async () => {
    await mockServer._handlers['coolify_update_service']({
      uuid: 'svc-uuid-1',
      name: 'my-service',
      instance: 'prod',
    });

    const callArgs = vi.mocked(client.coolifyPatch).mock.calls[0];
    const body = callArgs[1] as Record<string, unknown>;
    expect(body.name).toBe('my-service');
    expect(body.docker_compose_raw).toBeUndefined();
  });
});
