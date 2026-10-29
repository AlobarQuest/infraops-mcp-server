import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installRedaction } from '../src/utils/register-sanitized.js';
import { registerPorkbunTools } from '../src/tools/porkbun.js';
import type { PorkbunToolInfo } from '../src/services/porkbun-gateway.js';

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----';

const TOOLS: PorkbunToolInfo[] = [
  { name: 'get_ssl_bundle', description: 'SSL bundle', readOnly: true, inputSchema: { a: 1 } },
  { name: 'list_domains', description: 'List domains', readOnly: true, inputSchema: { b: 2 } },
  { name: 'create_dns_record', description: 'Create DNS', readOnly: false, inputSchema: {} },
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

  it('lists tools with access and area, and no schema by default', async () => {
    const list = await s.handlers.porkbun_list_tools({}, {});
    const { tools } = JSON.parse(list.content[0].text);
    expect(tools.map((t: any) => t.name)).toEqual([
      'get_ssl_bundle',
      'list_domains',
      'create_dns_record',
    ]);
    expect(tools[2]).toMatchObject({ access: 'write', area: 'dns' });
    expect(tools[0]).toMatchObject({ access: 'read', area: 'ssl' });
    expect(tools[0].inputSchema).toBeUndefined();
  });

  it('includes the schema when name matches exactly one tool, or when asked', async () => {
    const one = await s.handlers.porkbun_list_tools({ name: 'domains' }, {});
    const t1 = JSON.parse(one.content[0].text).tools;
    expect(t1).toHaveLength(1);
    expect(t1[0].inputSchema).toEqual({ b: 2 });

    const many = await s.handlers.porkbun_list_tools({ name: 'e', include_schema: true }, {});
    for (const t of JSON.parse(many.content[0].text).tools) expect(t.inputSchema).toBeDefined();
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
