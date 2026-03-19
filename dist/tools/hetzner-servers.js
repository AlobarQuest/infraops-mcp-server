/**
 * Hetzner Cloud Server management tools.
 *
 * Covers the core server lifecycle: list, get, create, delete,
 * power actions, metrics, and rebuild.
 */
import { z } from "zod";
import { hetznerGet, hetznerPost, hetznerDelete, handleHetznerError, } from "../services/hetzner-client.js";
export function registerHetznerServerTools(server) {
    // ── List Servers ─────────────────────────────────────────────────
    server.registerTool("hetzner_list_servers", {
        title: "List Hetzner Servers",
        description: "List all servers in the Hetzner Cloud project. Returns name, status, IP, server type, datacenter, and image.",
        inputSchema: {
            label_selector: z
                .string()
                .optional()
                .describe("Filter by label (e.g. 'env=production')"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ label_selector }) => {
        try {
            const params = {};
            if (label_selector)
                params.label_selector = label_selector;
            const result = await hetznerGet("/servers", params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleHetznerError(error) }],
            };
        }
    });
    // ── Get Server ───────────────────────────────────────────────────
    server.registerTool("hetzner_get_server", {
        title: "Get Hetzner Server",
        description: "Get full details for a server by ID — status, IPs, server type, datacenter, volumes, image, labels, protection.",
        inputSchema: {
            id: z.number().int().describe("Hetzner server ID"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ id }) => {
        try {
            const result = await hetznerGet(`/servers/${id}`);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleHetznerError(error) }],
            };
        }
    });
    // ── Server Metrics ───────────────────────────────────────────────
    server.registerTool("hetzner_server_metrics", {
        title: "Get Hetzner Server Metrics",
        description: "Get CPU, disk, and network metrics for a server. Useful for monitoring resource usage and identifying bottlenecks.",
        inputSchema: {
            id: z.number().int().describe("Hetzner server ID"),
            type: z
                .enum(["cpu", "disk", "network"])
                .describe("Metric type to retrieve"),
            start: z
                .string()
                .describe("Start time in ISO 8601 format (e.g. 2026-03-19T00:00:00Z)"),
            end: z
                .string()
                .describe("End time in ISO 8601 format"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ id, type, start, end, }) => {
        try {
            const result = await hetznerGet(`/servers/${id}/metrics`, { type, start, end });
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleHetznerError(error) }],
            };
        }
    });
    // ── Server Actions (power) ───────────────────────────────────────
    server.registerTool("hetzner_server_power", {
        title: "Hetzner Server Power Action",
        description: "Power on, power off, reboot, or reset a Hetzner server. " +
            "WARNING: poweroff and reset are hard actions — use shutdown for graceful stops.",
        inputSchema: {
            id: z.number().int().describe("Hetzner server ID"),
            action: z
                .enum(["poweron", "poweroff", "reboot", "reset", "shutdown"])
                .describe("Power action: poweron, poweroff (hard), shutdown (graceful), reboot (graceful), reset (hard)"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ id, action }) => {
        try {
            const result = await hetznerPost(`/servers/${id}/actions/${action}`);
            return {
                content: [
                    {
                        type: "text",
                        text: `Server ${id} ${action} initiated.\n${JSON.stringify(result, null, 2)}`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleHetznerError(error) }],
            };
        }
    });
    // ── Rebuild Server ───────────────────────────────────────────────
    server.registerTool("hetzner_server_rebuild", {
        title: "Rebuild Hetzner Server",
        description: "Rebuild a server with a new image. WARNING: This destroys all data on the server.",
        inputSchema: {
            id: z.number().int().describe("Hetzner server ID"),
            image: z
                .string()
                .describe("Image name or ID to rebuild with (e.g. 'ubuntu-22.04')"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ id, image }) => {
        try {
            const result = await hetznerPost(`/servers/${id}/actions/rebuild`, { image });
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleHetznerError(error) }],
            };
        }
    });
    // ── Create Server ────────────────────────────────────────────────
    server.registerTool("hetzner_create_server", {
        title: "Create Hetzner Server",
        description: "Create a new Hetzner Cloud server. Returns the server details and root password (if no SSH key specified).",
        inputSchema: {
            name: z.string().min(1).describe("Server name"),
            server_type: z
                .string()
                .describe("Server type (e.g. cx22, cx32, cpx21)"),
            image: z
                .string()
                .describe("OS image (e.g. ubuntu-22.04, debian-12)"),
            location: z
                .string()
                .optional()
                .describe("Datacenter location (e.g. fsn1, nbg1, hel1)"),
            ssh_keys: z
                .array(z.string())
                .optional()
                .describe("Array of SSH key names or IDs to install"),
            labels: z
                .record(z.string())
                .optional()
                .describe("Key-value labels for the server"),
            firewalls: z
                .array(z.object({ firewall: z.number().int() }))
                .optional()
                .describe("Firewall IDs to apply"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const body = {
                name: params.name,
                server_type: params.server_type,
                image: params.image,
            };
            if (params.location)
                body.location = params.location;
            if (params.ssh_keys)
                body.ssh_keys = params.ssh_keys;
            if (params.labels)
                body.labels = params.labels;
            if (params.firewalls)
                body.firewalls = params.firewalls;
            const result = await hetznerPost("/servers", body);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleHetznerError(error) }],
            };
        }
    });
    // ── Delete Server ────────────────────────────────────────────────
    server.registerTool("hetzner_delete_server", {
        title: "Delete Hetzner Server",
        description: "Permanently delete a Hetzner server. WARNING: This is irreversible. All data is destroyed.",
        inputSchema: {
            id: z.number().int().describe("Hetzner server ID"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ id }) => {
        try {
            const result = await hetznerDelete(`/servers/${id}`);
            return {
                content: [
                    { type: "text", text: `Server ${id} deleted.\n${JSON.stringify(result, null, 2)}` },
                ],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleHetznerError(error) }],
            };
        }
    });
}
//# sourceMappingURL=hetzner-servers.js.map