import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRequire } from 'module';
import {
  DENIED_TOOLS,
  PORKBUN_PACKAGE_VERSION,
  TOOL_AREAS,
  parseToolGroups,
  isExposed,
} from '../src/services/porkbun-catalog.js';

// The package has no main/exports, so resolve its stdio entry from package.json.
async function listInstalledToolNames(): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@porkbunllc/mcp-server/dist/index.js');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry] });
  const client = new Client({ name: 'porkbun-catalog-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } finally {
    await client.close();
  }
}

describe('porkbun catalog', () => {
  it('classifies every tool the pinned package serves, and nothing else', async () => {
    const names = await listInstalledToolNames();
    const classified = new Set([...DENIED_TOOLS, ...Object.keys(TOOL_AREAS)]);
    expect(names.filter((n) => !classified.has(n))).toEqual([]); // unreviewed new tools
    expect([...classified].filter((n) => !names.includes(n))).toEqual([]); // stale entries
    expect(names).toHaveLength(120);
  }, 30_000);

  it('names the installed and pinned package version', () => {
    const require = createRequire(import.meta.url);
    const installed = require('@porkbunllc/mcp-server/package.json').version;
    const pinned = require('../package.json').dependencies['@porkbunllc/mcp-server'];
    expect(installed).toBe(PORKBUN_PACKAGE_VERSION);
    expect(pinned).toBe(PORKBUN_PACKAGE_VERSION); // exact pin, no range
  });

  it('never both denies and allows a tool', () => {
    expect(Object.keys(TOOL_AREAS).filter((n) => DENIED_TOOLS.has(n))).toEqual([]);
  });

  it('denies every spend and sandbox tool', () => {
    for (const n of [
      'register_domain',
      'renew_domain',
      'transfer_domain',
      'buy_closeout',
      'create_hosting',
      'create_mailbox',
      'renew_mailbox',
      'top_up_account_credit',
      'configure_auto_topup',
      'top_up_with_usdc',
      'get_usdc_topup_status',
      'top_up_with_card_mpp',
      'create_sandbox_key',
      'sandbox_topup',
      'sandbox_reset',
      'sandbox_trigger_webhook',
      'request_api_key',
      'retrieve_api_key',
    ]) {
      expect(DENIED_TOOLS.has(n)).toBe(true);
    }
    expect(DENIED_TOOLS.size).toBe(18);
  });

  it('keeps update_auto_renew and cancel_transfer allowed', () => {
    expect(TOOL_AREAS.update_auto_renew).toBe('domains');
    expect(TOOL_AREAS.cancel_transfer).toBe('domains');
  });

  it('parses tool groups', () => {
    expect(parseToolGroups(undefined)).toBeNull();
    expect(parseToolGroups('  ')).toBeNull();
    expect([...parseToolGroups(' DNS, domains ')!].sort()).toEqual(['dns', 'domains']);
    expect(() => parseToolGroups('dns,bogus')).toThrow(/bogus/);
  });

  it('exposes by group', () => {
    const dns = parseToolGroups('dns');
    expect(isExposed('list_domains', null)).toBe(true);
    expect(isExposed('register_domain', null)).toBe(false);
    expect(isExposed('no_such_tool', null)).toBe(false);
    expect(isExposed('toString', null)).toBe(false); // inherited, not a catalog entry
    expect(isExposed('list_dns_records', dns)).toBe(true);
    expect(isExposed('list_domains', dns)).toBe(false);
  });
});
