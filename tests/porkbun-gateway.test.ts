import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { fileURLToPath } from 'url';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PorkbunGateway } from '../src/services/porkbun-gateway.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-porkbun-server.mjs', import.meta.url));
const ENV = { PORKBUN_API_KEY: 'pk', PORKBUN_SECRET_API_KEY: 'sk' };
const MISSING = '/nonexistent/index.js';

const text = (r: CallToolResult): string => (r.content[0] as { text: string }).text;
const pidOf = (r: CallToolResult): number => JSON.parse(text(r)).pid;

describe('PorkbunGateway', () => {
  let gw: PorkbunGateway;
  const extra: PorkbunGateway[] = [];
  let stderr: MockInstance<typeof process.stderr.write>;

  // Captures the forwarded child stderr, which would otherwise clutter the test output.
  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  function gateway(opts: ConstructorParameters<typeof PorkbunGateway>[0] = {}): PorkbunGateway {
    const g = new PorkbunGateway({ entryPath: FIXTURE, env: ENV, ...opts });
    extra.push(g);
    return g;
  }

  afterEach(async () => {
    await Promise.all(extra.splice(0).map((g) => g.close()));
    delete process.env.COOLIFY_API_TOKEN;
    vi.restoreAllMocks();
  });

  it('does not start a child until first use', async () => {
    const start = vi.spyOn(StdioClientTransport.prototype, 'start');
    gw = gateway();
    expect(start).not.toHaveBeenCalled();
    await gw.listTools();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('lists tools with readOnly from annotations', async () => {
    gw = gateway();
    const tools = await gw.listTools();
    expect(tools.find((t) => t.name === 'fake_read')!.readOnly).toBe(true);
    expect(tools.find((t) => t.name === 'fake_write')!.readOnly).toBe(false);
    expect(tools.find((t) => t.name === 'fake_exit')!.readOnly).toBe(false);
  });

  it('starts one child for concurrent first calls', async () => {
    const start = vi.spyOn(StdioClientTransport.prototype, 'start');
    gw = gateway();
    const [a, b] = await Promise.all([gw.callTool('fake_read', {}), gw.callTool('fake_read', {})]);
    expect(pidOf(a)).toBe(pidOf(b));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('passes only the Porkbun keys to the child', async () => {
    process.env.COOLIFY_API_TOKEN = 'must-not-leak';
    gw = gateway();
    const body = JSON.parse(text(await gw.callTool('fake_read', {})));
    expect(body.env).toEqual({
      PORKBUN_API_KEY: 'pk',
      PORKBUN_SECRET_API_KEY: 'sk',
      COOLIFY_API_TOKEN: false,
    });
  });

  it('returns the child content blocks unchanged', async () => {
    gw = gateway();
    const r = await gw.callTool('fake_read', {});
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe('text');
    expect(() => JSON.parse(text(r))).not.toThrow(); // not double-encoded
    expect(text(r)).toContain('\n  "env": {'); // the child's own pretty-printing
  });

  it('restarts after the child exits', async () => {
    gw = gateway();
    const first = pidOf(await gw.callTool('fake_read', {}));
    await expect(gw.callTool('fake_exit', {})).rejects.toThrow();
    expect(pidOf(await gw.callTool('fake_read', {}))).not.toBe(first);
  });

  it('names npm ci when the entry point is missing', async () => {
    const bad = gateway({ entryPath: MISSING });
    await expect(bad.listTools()).rejects.toThrow(/npm ci --omit=dev/);
  });

  it('backs off after three failed starts', async () => {
    let t = 0;
    const bad = gateway({ entryPath: MISSING, now: () => t });
    for (let i = 0; i < 3; i++) await expect(bad.listTools()).rejects.toThrow(/npm ci/);
    await expect(bad.listTools()).rejects.toThrow(/retry after 1970-01-01T00:05:00.000Z/i);
    t = 299_999;
    await expect(bad.listTools()).rejects.toThrow(/retry after/i);
    t = 300_001;
    await expect(bad.listTools()).rejects.toThrow(/npm ci/); // tries again
  });

  it('forwards child stderr with a [porkbun] prefix', async () => {
    gw = gateway();
    await gw.listTools();
    await vi.waitFor(() =>
      expect(stderr).toHaveBeenCalledWith('[porkbun] fake porkbun server started\n'),
    );
  });
});
