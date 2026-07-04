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
  handleCoolifyError: vi.fn((error: unknown) => {
    const e = error as any;
    if (e?.response?.status === 404) return `Error: Resource not found.`;
    return `Error: ${e}`;
  }),
}));

import { registerApplicationTools } from '../src/tools/applications.js';

describe('coolify_application_logs', () => {
  beforeEach(() => {
    mockServer._handlers = {};
    registerApplicationTools(mockServer as any);
  });

  it('returns informational message (not isError) when app is not running (HTTP 400)', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: {
        status: 400,
        data: { message: 'Application is not running.' },
      },
    });
    vi.mocked(client.coolifyGet).mockRejectedValueOnce(axiosError);

    const result = await mockServer._handlers['coolify_application_logs']({
      uuid: 'app-uuid-1',
      lines: 100,
      instance: 'prod',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('not running');
  });

  it('returns isError for non-400 errors (e.g. 404)', async () => {
    const axiosError = Object.assign(new Error('Not found'), {
      isAxiosError: true,
      response: { status: 404, data: { message: 'Application not found' } },
    });
    vi.mocked(client.coolifyGet).mockRejectedValueOnce(axiosError);

    const result = await mockServer._handlers['coolify_application_logs']({
      uuid: 'app-uuid-1',
      lines: 100,
      instance: 'prod',
    });

    expect(result.isError).toBe(true);
  });
});
