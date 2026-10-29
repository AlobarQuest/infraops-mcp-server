import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { CHARACTER_LIMIT } from '../src/constants.js';
import { TOOL_AREAS } from '../src/services/porkbun-catalog.js';
import { installRedaction } from '../src/utils/register-sanitized.js';
import { registerPorkbunTools } from '../src/tools/porkbun.js';
import { PorkbunGateway } from '../src/services/porkbun-gateway.js';
import type { PorkbunToolInfo } from '../src/services/porkbun-gateway.js';

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----';

const TOOLS: PorkbunToolInfo[] = [
  { name: 'get_ssl_bundle', description: 'SSL bundle', readOnly: true, inputSchema: { a: 1 } },
  { name: 'list_domains', description: 'List domains', readOnly: true, inputSchema: { b: 2 } },
  { name: 'create_dns_record', description: 'Create DNS', readOnly: false, inputSchema: {} },
  { name: 'create_wp_credentials', description: 'WP creds', readOnly: false, inputSchema: {} },
  { name: 'setup_mailbox', description: 'Mailbox', readOnly: false, inputSchema: {} },
  { name: 'register_domain', description: 'Register', readOnly: false, inputSchema: {} },
];

// The child's real result format.
const childText = (obj: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
});

function fakeServer() {
  const handlers: Record<string, Function> = {};
  const configs: Record<string, any> = {};
  return {
    registerTool(name: string, config: any, cb: Function) {
      configs[name] = config;
      handlers[name] = cb;
    },
    handlers,
    configs,
  };
}

function setup() {
  const stub = {
    calls: [] as [string, unknown][],
    result: childText({ status: 'SUCCESS' }) as any,
    failWith: undefined as Error | undefined,
    async listTools() {
      return TOOLS;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      stub.calls.push([name, args]);
      if (stub.failWith) throw stub.failWith;
      return stub.result;
    },
  };
  const s = fakeServer();
  installRedaction(s as any);
  registerPorkbunTools(s as any, stub as any);
  return { s, stub };
}

describe('porkbun tools', () => {
  let s: ReturnType<typeof setup>['s'];
  let stub: ReturnType<typeof setup>['stub'];

  beforeEach(() => {
    ({ s, stub } = setup());
  });
  afterEach(() => {
    delete process.env.PORKBUN_TOOL_GROUPS;
  });

  it('registers exactly three tools', () =>
    expect(Object.keys(s.handlers).sort()).toEqual([
      'porkbun_list_tools',
      'porkbun_read',
      'porkbun_write',
    ]));

  it('marks porkbun_read read-only and porkbun_write not', () => {
    expect(s.configs.porkbun_read.annotations.readOnlyHint).toBe(true);
    expect(s.configs.porkbun_write.annotations.readOnlyHint).toBe(false);
    expect(s.configs.porkbun_write.annotations.destructiveHint).toBe(true);
  });

  it('routes a read tool through porkbun_read', async () => {
    const r = await s.handlers.porkbun_read({ tool: 'list_domains', arguments: {} }, {});
    expect(r.isError).toBeUndefined();
    expect(stub.calls).toEqual([['list_domains', {}]]);
  });

  it('routes a write tool through porkbun_write with its arguments', async () => {
    await s.handlers.porkbun_write(
      { tool: 'create_dns_record', arguments: { domain: 'd.com' } },
      {},
    );
    expect(stub.calls).toEqual([['create_dns_record', { domain: 'd.com' }]]);
  });

  it('refuses a write tool through porkbun_read and names porkbun_write', async () => {
    const r = await s.handlers.porkbun_read({ tool: 'create_dns_record', arguments: {} }, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/porkbun_write/);
    expect(stub.calls).toEqual([]);
  });

  it('refuses a read tool through porkbun_write and names porkbun_read', async () => {
    const r = await s.handlers.porkbun_write({ tool: 'list_domains', arguments: {} }, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/porkbun_read/);
    expect(stub.calls).toEqual([]);
  });

  it('refuses a denied tool in both and never lists it', async () => {
    for (const h of [s.handlers.porkbun_read, s.handlers.porkbun_write]) {
      const r = await h({ tool: 'register_domain', arguments: {} }, {});
      expect(r.isError).toBe(true);
    }
    expect(stub.calls).toEqual([]);
    const list = await s.handlers.porkbun_list_tools({}, {});
    expect(list.content[0].text).not.toContain('register_domain');
  });

  it('refuses an unknown tool name', async () => {
    const r = await s.handlers.porkbun_read({ tool: 'nope', arguments: {} }, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/porkbun_list_tools/);
    expect(stub.calls).toEqual([]);
  });

  it('lists compact rows by default: access and area, no description or schema', async () => {
    const list = await s.handlers.porkbun_list_tools({}, {});
    const { tools } = JSON.parse(list.content[0].text);
    expect(tools.map((t: any) => t.name)).toEqual([
      'get_ssl_bundle',
      'list_domains',
      'create_dns_record',
      'create_wp_credentials',
      'setup_mailbox',
    ]);
    expect(tools[2]).toEqual({ name: 'create_dns_record', access: 'write', area: 'dns' });
    expect(tools[0]).toEqual({ name: 'get_ssl_bundle', access: 'read', area: 'ssl' });
  });

  it('adds descriptions when name filters, and the schema when name matches one tool', async () => {
    const one = await s.handlers.porkbun_list_tools({ name: 'domains' }, {});
    const t1 = JSON.parse(one.content[0].text).tools;
    expect(t1).toHaveLength(1);
    expect(t1[0]).toMatchObject({ description: 'List domains', inputSchema: { b: 2 } });

    const several = await s.handlers.porkbun_list_tools({ name: 'e' }, {});
    const t2 = JSON.parse(several.content[0].text).tools;
    expect(t2.length).toBeGreaterThan(1);
    for (const t of t2) {
      expect(t.description).toBeDefined();
      expect(t.inputSchema).toBeUndefined();
    }

    const many = await s.handlers.porkbun_list_tools({ name: 'e', include_schema: true }, {});
    for (const t of JSON.parse(many.content[0].text).tools) expect(t.inputSchema).toBeDefined();
  });

  it('ignores include_schema without a name filter', async () => {
    const list = await s.handlers.porkbun_list_tools({ include_schema: true }, {});
    for (const t of JSON.parse(list.content[0].text).tools) {
      expect(t.inputSchema).toBeUndefined();
      expect(t.description).toBeUndefined();
    }
  });

  it('filters by area, and rejects an unknown area', async () => {
    const list = await s.handlers.porkbun_list_tools({ area: 'hosting' }, {});
    expect(JSON.parse(list.content[0].text).tools).toEqual([
      { name: 'create_wp_credentials', access: 'write', area: 'hosting' },
    ]);
    const schema = z.object(s.configs.porkbun_list_tools.inputSchema);
    expect(schema.safeParse({ area: 'dns' }).success).toBe(true);
    expect(schema.safeParse({ area: 'bogus' }).success).toBe(false);
  });

  it('honours PORKBUN_TOOL_GROUPS', async () => {
    process.env.PORKBUN_TOOL_GROUPS = 'dns';
    ({ s, stub } = setup());
    const list = await s.handlers.porkbun_list_tools({}, {});
    expect(JSON.parse(list.content[0].text).tools.map((t: any) => t.name)).toEqual([
      'create_dns_record',
    ]);
    const r = await s.handlers.porkbun_read({ tool: 'list_domains', arguments: {} }, {});
    expect(r.isError).toBe(true);
    expect(stub.calls).toEqual([]);
  });

  it('masks the SSL private key by default', async () => {
    stub.result = childText({ status: 'SUCCESS', certificatechain: 'x', privatekey: PEM });
    const r = await s.handlers.porkbun_read(
      { tool: 'get_ssl_bundle', arguments: { domain: 'd.com' } },
      {},
    );
    expect(r.content[0].text).not.toContain('BEGIN PRIVATE KEY');
  });

  it('reveals the SSL private key with reveal:true', async () => {
    stub.result = childText({ status: 'SUCCESS', privatekey: PEM });
    const r = await s.handlers.porkbun_read(
      { tool: 'get_ssl_bundle', arguments: {}, reveal: true },
      {},
    );
    expect(r.content[0].text).toContain('BEGIN PRIVATE KEY');
  });

  it('masks a webhook secret by field name', async () => {
    stub.result = childText({ webhook: { id: 1, secret: 'whsec_abc' } });
    const r = await s.handlers.porkbun_read({ tool: 'list_domains', arguments: {} }, {});
    expect(r.content[0].text).not.toContain('whsec_abc');
  });

  it('reveals a webhook secret with reveal:true', async () => {
    stub.result = childText({ webhook: { id: 1, secret: 'whsec_abc' } });
    const r = await s.handlers.porkbun_read(
      { tool: 'list_domains', arguments: {}, reveal: true },
      {},
    );
    expect(r.content[0].text).toContain('whsec_abc');
  });

  // Real response shape from Porkbun's OpenAPI spec for createWpCredentials.
  const wpCredentials = () => ({
    status: 'SUCCESS',
    credentials: {
      username: 'porkbun-agent',
      applicationPassword: 'abcd EFGH 1234 ijkl',
      role: 'editor',
      name: 'Acme-Agent',
      restUrl: 'https://d.com/wp-json/',
      authorization: 'Basic cG9ya2J1bi1hZ2VudDphYmNk',
    },
    message: 'Save this now',
  });

  it('masks a WordPress application password and auth header by default', async () => {
    stub.result = childText(wpCredentials());
    const r = await s.handlers.porkbun_write({ tool: 'create_wp_credentials', arguments: {} }, {});
    const text = r.content[0].text;
    expect(text).not.toContain('abcd EFGH 1234 ijkl');
    expect(text).not.toContain('cG9ya2J1bi1hZ2VudDphYmNk');
    expect(text).toContain('SUCCESS');
  });

  it('reveals a WordPress application password and auth header with reveal:true', async () => {
    stub.result = childText(wpCredentials());
    const r = await s.handlers.porkbun_write(
      { tool: 'create_wp_credentials', arguments: {}, reveal: true },
      {},
    );
    expect(r.content[0].text).toContain('abcd EFGH 1234 ijkl');
    expect(r.content[0].text).toContain('cG9ya2J1bi1hZ2VudDphYmNk');
  });

  it('masks a mailbox password by default', async () => {
    stub.result = childText({ status: 'SUCCESS', address: 'a@d.com', password: 'Zq9!mailboxPw' });
    const r = await s.handlers.porkbun_write({ tool: 'setup_mailbox', arguments: {} }, {});
    expect(r.content[0].text).not.toContain('Zq9!mailboxPw');
    expect(r.content[0].text).toContain('a@d.com');
  });

  it('reveals a mailbox password with reveal:true', async () => {
    stub.result = childText({ status: 'SUCCESS', password: 'Zq9!mailboxPw' });
    const r = await s.handlers.porkbun_write(
      { tool: 'setup_mailbox', arguments: {}, reveal: true },
      {},
    );
    expect(r.content[0].text).toContain('Zq9!mailboxPw');
  });

  it('passes isError from the child through', async () => {
    stub.result = { ...childText({ status: 'ERROR', message: 'bad' }), isError: true };
    const r = await s.handlers.porkbun_read({ tool: 'list_domains', arguments: {} }, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('bad');
  });

  it('turns a gateway failure into a clear Porkbun error', async () => {
    stub.failWith = new Error('MCP error -32000: Connection closed');
    const r = await s.handlers.porkbun_read({ tool: 'list_domains', arguments: {} }, {});
    expect(r.isError).toBe(true);
    const text = r.content[0].text;
    expect(text).toContain('list_domains');
    expect(text).toContain('Connection closed');
    expect(text).toMatch(/Porkbun/);
    expect(text).toMatch(/fresh|next call/i);
  });
});

// Lists the REAL pinned package's tools (tools/list needs no credentials and makes no API call).
describe('porkbun_list_tools against the installed package', () => {
  it('lists every allowed tool within CHARACTER_LIMIT by default', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const gw = new PorkbunGateway({ env: {} });
    try {
      const s = fakeServer();
      installRedaction(s as any);
      registerPorkbunTools(s as any, gw);
      const text: string = (await s.handlers.porkbun_list_tools({}, {})).content[0].text;
      expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
      expect(text).not.toContain('[truncated');
      const listed = JSON.parse(text).tools.map((t: any) => t.name);
      expect(listed.sort()).toEqual(Object.keys(TOOL_AREAS).sort());
      expect(listed).toHaveLength(102);
    } finally {
      await gw.close();
      vi.restoreAllMocks();
    }
  }, 30_000);
});
