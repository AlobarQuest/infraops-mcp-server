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
  handleCoolifyError: vi.fn((e) => `Error: ${e}`),
}));

import { registerDatabaseBackupTools } from '../src/tools/database-backups.js';

describe('database backup tools', () => {
  beforeEach(() => {
    mockServer._handlers = {};
    mockServer._schemas = {};
    vi.clearAllMocks();
    registerDatabaseBackupTools(mockServer as any);
  });

  it('list hits /databases/{db}/backups', async () => {
    vi.mocked(client.coolifyGet).mockResolvedValueOnce([]);
    await mockServer._handlers['coolify_list_database_backups']({
      database_uuid: 'db1',
      instance: 'prod',
    });
    expect(client.coolifyGet).toHaveBeenCalledWith('/databases/db1/backups', undefined, 'prod');
  });

  it('create POSTs the config (without database_uuid/instance) to the backups endpoint', async () => {
    vi.mocked(client.coolifyPost).mockResolvedValueOnce({ uuid: 'b1' });
    await mockServer._handlers['coolify_create_database_backup']({
      database_uuid: 'db1',
      frequency: '0 2 * * *',
      enabled: true,
      instance: 'dev',
    });
    expect(client.coolifyPost).toHaveBeenCalledWith(
      '/databases/db1/backups',
      { frequency: '0 2 * * *', enabled: true },
      'dev',
    );
  });

  it('delete execution hits the nested executions path', async () => {
    vi.mocked(client.coolifyDelete).mockResolvedValueOnce({ message: 'ok' });
    await mockServer._handlers['coolify_delete_backup_execution']({
      database_uuid: 'db1',
      backup_uuid: 'b1',
      execution_uuid: 'e1',
      instance: 'prod',
    });
    expect(client.coolifyDelete).toHaveBeenCalledWith(
      '/databases/db1/backups/b1/executions/e1',
      'prod',
    );
  });

  it('mutating create requires an explicit instance', () => {
    expect(
      mockServer._schemas['coolify_create_database_backup'].inputSchema.instance.safeParse(
        undefined,
      ).success,
    ).toBe(false);
  });

  it('read list defaults instance to prod', () => {
    expect(
      mockServer._schemas['coolify_list_database_backups'].inputSchema.instance.parse(undefined),
    ).toBe('prod');
  });
});
