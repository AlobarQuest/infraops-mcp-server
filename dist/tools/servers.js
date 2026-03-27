/**
 * Server management tools for Coolify.
 *
 * Manage the underlying servers (VPS instances) that host Coolify resources.
 * Devon currently runs a single Hetzner VPS.
 */
import { coolifyGet, handleCoolifyError, } from "../services/coolify-client.js";
import { UuidSchema, CoolifyInstanceSchema } from "../schemas/common.js";
export function registerServerTools(server) {
    // ── List Servers ─────────────────────────────────────────────────
    server.registerTool("coolify_list_servers", {
        title: "List Coolify Servers",
        description: "List all servers registered with Coolify. Returns name, IP, reachability status, and UUID for each.",
        inputSchema: { instance: CoolifyInstanceSchema },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ instance }) => {
        try {
            const servers = await coolifyGet("/servers", undefined, instance);
            return {
                content: [
                    { type: "text", text: JSON.stringify(servers, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Get Server ───────────────────────────────────────────────────
    server.registerTool("coolify_get_server", {
        title: "Get Coolify Server",
        description: "Get full details for a server by UUID — IP, settings, connectivity status, and validation logs.",
        inputSchema: { uuid: UuidSchema, instance: CoolifyInstanceSchema },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ uuid, instance }) => {
        try {
            const srv = await coolifyGet(`/servers/${uuid}`, undefined, instance);
            return {
                content: [{ type: "text", text: JSON.stringify(srv, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Validate Server ──────────────────────────────────────────────
    server.registerTool("coolify_validate_server", {
        title: "Validate Coolify Server",
        description: "Test SSH connectivity and Docker prerequisites for a server. " +
            "Use this to verify a server is properly connected before deploying resources.",
        inputSchema: { uuid: UuidSchema, instance: CoolifyInstanceSchema },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ uuid, instance }) => {
        try {
            const result = await coolifyGet(`/servers/${uuid}/validate`, undefined, instance);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Server Resources ─────────────────────────────────────────────
    server.registerTool("coolify_server_resources", {
        title: "List Server Resources",
        description: "List all applications, databases, and services deployed on a specific server. " +
            "Great for getting a full inventory of what's running on your VPS.",
        inputSchema: { uuid: UuidSchema, instance: CoolifyInstanceSchema },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ uuid, instance }) => {
        try {
            const resources = await coolifyGet(`/servers/${uuid}/resources`, undefined, instance);
            return {
                content: [
                    { type: "text", text: JSON.stringify(resources, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Server Domains ───────────────────────────────────────────────
    server.registerTool("coolify_server_domains", {
        title: "List Server Domains",
        description: "Retrieve all domain-to-resource mappings configured on a server. " +
            "Shows which apps are reachable at which FQDNs.",
        inputSchema: { uuid: UuidSchema, instance: CoolifyInstanceSchema },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ uuid, instance }) => {
        try {
            const domains = await coolifyGet(`/servers/${uuid}/domains`, undefined, instance);
            return {
                content: [
                    { type: "text", text: JSON.stringify(domains, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
}
//# sourceMappingURL=servers.js.map