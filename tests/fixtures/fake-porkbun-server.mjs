// Stand-in for @porkbunllc/mcp-server in tests/porkbun-gateway.test.ts: a stdio MCP
// server that reports its environment and pid, and can be told to crash.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'fake-porkbun', version: '0.0.0' });

server.registerTool(
  'fake_read',
  { description: 'Report env and pid', annotations: { readOnlyHint: true } },
  async () => {
    const env = {
      PORKBUN_API_KEY: process.env.PORKBUN_API_KEY,
      PORKBUN_SECRET_API_KEY: process.env.PORKBUN_SECRET_API_KEY,
      COOLIFY_API_TOKEN: 'COOLIFY_API_TOKEN' in process.env,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify({ env, pid: process.pid }, null, 2) }],
    };
  },
);

server.registerTool(
  'fake_write',
  { description: 'A mutating tool', annotations: { readOnlyHint: false } },
  async () => ({ content: [{ type: 'text', text: '{}' }] }),
);

server.registerTool('fake_exit', { description: 'Crash the server' }, async () => {
  process.exit(1);
});

console.error('fake porkbun server started');
await server.connect(new StdioServerTransport());
