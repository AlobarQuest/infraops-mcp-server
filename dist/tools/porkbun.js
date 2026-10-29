/**
 * Porkbun tools — a gateway to Porkbun's official MCP server.
 *
 * Three fixed tools front the child's catalog, so the tool list stays small and
 * an upgrade of the pinned package cannot add a tool that is callable unreviewed:
 *   1. porkbun_list_tools → what the child offers (read/write, area; description and
 *      schema behind a name filter, to stay under CHARACTER_LIMIT)
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
import { z } from 'zod';
import { PORKBUN_AREAS, TOOL_AREAS, isExposed, parseToolGroups, } from '../services/porkbun-catalog.js';
import { getPorkbunGateway } from '../services/porkbun-gateway.js';
import { jsonResponse } from '../utils/response.js';
const ToolNameSchema = z.string().min(1).describe('Porkbun tool name (see porkbun_list_tools)');
const ArgumentsSchema = z
    .record(z.string(), z.unknown())
    .default({})
    .describe('Arguments for the Porkbun tool, per its inputSchema from porkbun_list_tools');
function errorResponse(text) {
    return { isError: true, content: [{ type: 'text', text }] };
}
export function registerPorkbunTools(server, gateway = getPorkbunGateway()) {
    const groups = parseToolGroups(process.env.PORKBUN_TOOL_GROUPS);
    // ── List Tools ────────────────────────────────────────────────────
    server.registerTool('porkbun_list_tools', {
        title: 'List Porkbun Tools',
        description: 'List the Porkbun tools reachable through this server. With no name, returns one compact ' +
            "row per tool: name, access ('read' → call via porkbun_read, 'write' → porkbun_write) " +
            'and area. Pass area to list one area (dns, domains, ssl, ...). Pass name to filter by ' +
            'substring and get descriptions too; the input schema is included when name matches ' +
            'exactly one tool, or when include_schema is true (ignored without name).',
        inputSchema: {
            name: z
                .string()
                .optional()
                .describe('Substring filter on tool name; adds descriptions (and schemas, see below)'),
            area: z.enum(PORKBUN_AREAS).optional().describe('Only list tools in this area'),
            include_schema: z
                .boolean()
                .optional()
                .describe('With name: include every match inputSchema (default: only when one tool matches)'),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ name, area, include_schema, }) => {
        try {
            const matches = (await gateway.listTools()).filter((t) => isExposed(t.name, groups) &&
                (!area || TOOL_AREAS[t.name] === area) &&
                (!name || t.name.includes(name)));
            // The full catalog with descriptions is ~67K characters, so they need a name filter.
            const withSchema = !!name && (include_schema ?? matches.length === 1);
            return jsonResponse({
                tools: matches.map((t) => ({
                    name: t.name,
                    access: t.readOnly ? 'read' : 'write',
                    area: TOOL_AREAS[t.name],
                    ...(name ? { description: t.description } : {}),
                    ...(withSchema ? { inputSchema: t.inputSchema } : {}),
                })),
            });
        }
        catch (error) {
            return errorResponse(failureMessage('porkbun_list_tools', error));
        }
    });
    // ── Read / Write ──────────────────────────────────────────────────
    function callHandler(access) {
        const other = access === 'read' ? 'porkbun_write' : 'porkbun_read';
        return async ({ tool, arguments: args, }) => {
            try {
                const info = (await gateway.listTools()).find((t) => t.name === tool);
                if (!info || !isExposed(tool, groups)) {
                    return errorResponse(`Porkbun tool '${tool}' is not available through this server. ` +
                        'Use porkbun_list_tools to see what is.');
                }
                if ((info.readOnly ? 'read' : 'write') !== access) {
                    return errorResponse(`'${tool}' is a ${access === 'read' ? 'write' : 'read'} tool; call it through ${other}.`);
                }
                return await gateway.callTool(tool, args);
            }
            catch (error) {
                return errorResponse(failureMessage(tool, error));
            }
        };
    }
    server.registerTool('porkbun_read', {
        title: 'Call Porkbun Read Tool',
        description: 'Call a read-only Porkbun tool (domains, DNS records, SSL bundles, pricing, etc.). ' +
            'Use porkbun_list_tools to find tool names and their arguments. ' +
            'Secrets in the response are masked unless reveal is true.',
        inputSchema: { tool: ToolNameSchema, arguments: ArgumentsSchema },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, callHandler('read'));
    server.registerTool('porkbun_write', {
        title: 'Call Porkbun Write Tool',
        description: 'Call a Porkbun tool that changes state (DNS records, nameservers, contacts, webhooks, etc.). ' +
            'Use porkbun_list_tools to find tool names and their arguments. ' +
            'Purchases, renewals, transfers and top-ups are not available.',
        inputSchema: { tool: ToolNameSchema, arguments: ArgumentsSchema },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, callHandler('write'));
}
function failureMessage(tool, error) {
    const message = error instanceof Error ? error.message : String(error);
    return (`Porkbun call to '${tool}' failed: ${message}. ` +
        'If the Porkbun process exited, the next call starts a fresh one.');
}
//# sourceMappingURL=porkbun.js.map