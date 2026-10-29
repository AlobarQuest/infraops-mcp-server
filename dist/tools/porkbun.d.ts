/**
 * Porkbun tools — a gateway to Porkbun's official MCP server.
 *
 * Three fixed tools front the child's catalog, so the tool list stays small and
 * an upgrade of the pinned package cannot add a tool that is callable unreviewed:
 *   1. porkbun_list_tools → what the child offers (read/write, area, schema)
 *   2. porkbun_read       → call a read-only child tool
 *   3. porkbun_write      → call a mutating child tool
 * Purchase, top-up, sandbox and API-key tools are never exposed (DENIED_TOOLS).
 *
 * Child results are returned as-is: installRedaction parses their JSON text to
 * mask secrets (SSL private keys, webhook secrets), so never re-wrap them.
 *
 * Environment variables:
 *   PORKBUN_TOOL_GROUPS - Comma-separated areas to expose (default: all allowed tools)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PorkbunGateway } from '../services/porkbun-gateway.js';
export declare function registerPorkbunTools(server: McpServer, gateway?: Pick<PorkbunGateway, 'listTools' | 'callTool'>): void;
//# sourceMappingURL=porkbun.d.ts.map