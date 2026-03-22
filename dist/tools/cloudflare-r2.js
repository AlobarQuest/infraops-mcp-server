/**
 * Cloudflare R2 bucket management tools.
 *
 * Covers R2 bucket lifecycle: list, create, get, delete.
 */
import { z } from "zod";
import { cloudflareGet, cloudflarePost, cloudflareDelete, handleCloudflareError, getAccountId, } from "../services/cloudflare-client.js";
export function registerCloudflareR2Tools(server) {
    // ── List R2 Buckets ──────────────────────────────────────────────
    server.registerTool("cloudflare_list_r2_buckets", {
        title: "List Cloudflare R2 Buckets",
        description: "List all R2 buckets in the Cloudflare account. Returns bucket names, creation dates, and location hints.",
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async () => {
        try {
            const accountId = getAccountId();
            const result = await cloudflareGet(`/accounts/${accountId}/r2/buckets`);
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
    // ── Create R2 Bucket ─────────────────────────────────────────────
    server.registerTool("cloudflare_create_r2_bucket", {
        title: "Create Cloudflare R2 Bucket",
        description: "Create a new R2 bucket in the Cloudflare account. Bucket names must be unique within the account.",
        inputSchema: {
            name: z.string().describe("Name for the new R2 bucket"),
            locationHint: z
                .enum(["wnam", "enam", "weur", "eeur", "apac"])
                .optional()
                .describe("Location hint for the bucket: wnam (Western North America), enam (Eastern North America), weur (Western Europe), eeur (Eastern Europe), apac (Asia Pacific)"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ name, locationHint }) => {
        try {
            const accountId = getAccountId();
            const body = { name };
            if (locationHint !== undefined)
                body.locationHint = locationHint;
            const result = await cloudflarePost(`/accounts/${accountId}/r2/buckets`, body);
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
    // ── Get R2 Bucket ────────────────────────────────────────────────
    server.registerTool("cloudflare_get_r2_bucket", {
        title: "Get Cloudflare R2 Bucket",
        description: "Get details for a specific R2 bucket by name — creation date, location, and storage class.",
        inputSchema: {
            name: z.string().describe("Name of the R2 bucket"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ name }) => {
        try {
            const accountId = getAccountId();
            const result = await cloudflareGet(`/accounts/${accountId}/r2/buckets/${name}`);
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
    // ── Delete R2 Bucket ─────────────────────────────────────────────
    server.registerTool("cloudflare_delete_r2_bucket", {
        title: "Delete Cloudflare R2 Bucket",
        description: "Permanently delete an R2 bucket. WARNING: This is irreversible and will delete all objects in the bucket.",
        inputSchema: {
            name: z.string().describe("Name of the R2 bucket to delete"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ name }) => {
        try {
            const accountId = getAccountId();
            const result = await cloudflareDelete(`/accounts/${accountId}/r2/buckets/${name}`);
            return {
                content: [
                    {
                        type: "text",
                        text: `R2 bucket '${name}' deleted.\n${JSON.stringify(result, null, 2)}`,
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
//# sourceMappingURL=cloudflare-r2.js.map