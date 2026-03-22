/**
 * Cloudflare DNS management tools.
 *
 * Covers zone listing/lookup and DNS record CRUD:
 * list zones, get zone, list records, create, update, delete.
 */
import { z } from "zod";
import { cloudflareGet, cloudflarePost, cloudflarePut, cloudflareDelete, handleCloudflareError, } from "../services/cloudflare-client.js";
export function registerCloudflareDNSTools(server) {
    // ── List Zones ───────────────────────────────────────────────────
    server.registerTool("cloudflare_list_zones", {
        title: "List Cloudflare Zones",
        description: "List all zones in the Cloudflare account. Optionally filter by zone name. Returns zone ID, name, status, and nameservers.",
        inputSchema: {
            name: z
                .string()
                .optional()
                .describe("Filter by zone name (e.g. 'example.com')"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ name }) => {
        try {
            const params = {};
            if (name)
                params.name = name;
            const result = await cloudflareGet("/zones", params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCloudflareError(error) }],
            };
        }
    });
    // ── Get Zone ─────────────────────────────────────────────────────
    server.registerTool("cloudflare_get_zone", {
        title: "Get Cloudflare Zone",
        description: "Get full details for a Cloudflare zone by ID — name, status, nameservers, plan, and settings.",
        inputSchema: {
            zone_id: z.string().describe("Cloudflare zone ID"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ zone_id }) => {
        try {
            const result = await cloudflareGet(`/zones/${zone_id}`);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCloudflareError(error) }],
            };
        }
    });
    // ── List DNS Records ─────────────────────────────────────────────
    server.registerTool("cloudflare_list_dns_records", {
        title: "List Cloudflare DNS Records",
        description: "List all DNS records for a zone. Optionally filter by record type and/or name.",
        inputSchema: {
            zone_id: z.string().describe("Cloudflare zone ID"),
            type: z
                .enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "CAA"])
                .optional()
                .describe("Filter by DNS record type"),
            name: z
                .string()
                .optional()
                .describe("Filter by record name (e.g. 'www.example.com')"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ zone_id, type, name, }) => {
        try {
            const params = {};
            if (type)
                params.type = type;
            if (name)
                params.name = name;
            const result = await cloudflareGet(`/zones/${zone_id}/dns_records`, params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCloudflareError(error) }],
            };
        }
    });
    // ── Create DNS Record ────────────────────────────────────────────
    server.registerTool("cloudflare_create_dns_record", {
        title: "Create Cloudflare DNS Record",
        description: "Create a new DNS record in a Cloudflare zone. Returns the created record with its ID.",
        inputSchema: {
            zone_id: z.string().describe("Cloudflare zone ID"),
            type: z
                .enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "CAA"])
                .describe("DNS record type"),
            name: z.string().describe("DNS record name (e.g. 'www' or 'www.example.com')"),
            content: z.string().describe("DNS record content (e.g. IP address or target hostname)"),
            ttl: z
                .number()
                .optional()
                .describe("Time to live in seconds. 1 = auto (Cloudflare default)"),
            proxied: z
                .boolean()
                .optional()
                .describe("Whether the record is proxied through Cloudflare (orange cloud)"),
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
                type: params.type,
                name: params.name,
                content: params.content,
            };
            if (params.ttl !== undefined)
                body.ttl = params.ttl;
            if (params.proxied !== undefined)
                body.proxied = params.proxied;
            const result = await cloudflarePost(`/zones/${params.zone_id}/dns_records`, body);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCloudflareError(error) }],
            };
        }
    });
    // ── Update DNS Record ────────────────────────────────────────────
    server.registerTool("cloudflare_update_dns_record", {
        title: "Update Cloudflare DNS Record",
        description: "Update an existing DNS record in a Cloudflare zone. Replaces the full record.",
        inputSchema: {
            zone_id: z.string().describe("Cloudflare zone ID"),
            record_id: z.string().describe("DNS record ID to update"),
            type: z
                .enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "CAA"])
                .describe("DNS record type"),
            name: z.string().describe("DNS record name (e.g. 'www' or 'www.example.com')"),
            content: z.string().describe("DNS record content (e.g. IP address or target hostname)"),
            ttl: z
                .number()
                .optional()
                .describe("Time to live in seconds. 1 = auto (Cloudflare default)"),
            proxied: z
                .boolean()
                .optional()
                .describe("Whether the record is proxied through Cloudflare (orange cloud)"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const body = {
                type: params.type,
                name: params.name,
                content: params.content,
            };
            if (params.ttl !== undefined)
                body.ttl = params.ttl;
            if (params.proxied !== undefined)
                body.proxied = params.proxied;
            const result = await cloudflarePut(`/zones/${params.zone_id}/dns_records/${params.record_id}`, body);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCloudflareError(error) }],
            };
        }
    });
    // ── Delete DNS Record ────────────────────────────────────────────
    server.registerTool("cloudflare_delete_dns_record", {
        title: "Delete Cloudflare DNS Record",
        description: "Permanently delete a DNS record from a Cloudflare zone. WARNING: This is irreversible.",
        inputSchema: {
            zone_id: z.string().describe("Cloudflare zone ID"),
            record_id: z.string().describe("DNS record ID to delete"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ zone_id, record_id }) => {
        try {
            const result = await cloudflareDelete(`/zones/${zone_id}/dns_records/${record_id}`);
            return {
                content: [
                    {
                        type: "text",
                        text: `DNS record ${record_id} deleted.\n${JSON.stringify(result, null, 2)}`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCloudflareError(error) }],
            };
        }
    });
}
//# sourceMappingURL=cloudflare-dns.js.map