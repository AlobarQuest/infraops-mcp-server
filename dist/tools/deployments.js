/**
 * Deployment tools for Coolify.
 *
 * Trigger, monitor, and inspect deployments.
 */
import { z } from "zod";
import { coolifyGet, coolifyPost, handleCoolifyError, } from "../services/coolify-client.js";
import { CoolifyInstanceSchema, CoolifyInstanceRequiredSchema } from "../schemas/common.js";
export function registerDeploymentTools(server) {
    // ── Deploy Application ───────────────────────────────────────────
    server.registerTool("coolify_deploy", {
        title: "Deploy Application",
        description: "Trigger a deployment for one or more applications. Can deploy by application UUID or by tag " +
            "(tags let you deploy an entire group of apps at once). Returns the deployment UUID for tracking.",
        inputSchema: {
            uuid: z
                .string()
                .optional()
                .describe("Application UUID to deploy (use this OR tag, not both)"),
            tag: z
                .string()
                .optional()
                .describe("Deploy all applications matching this tag"),
            force: z
                .boolean()
                .default(false)
                .describe("Force rebuild even if no changes detected (default: false)"),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ uuid, tag, force, instance, }) => {
        try {
            if (!uuid && !tag) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: "Error: Provide either 'uuid' (single app) or 'tag' (batch deploy). Neither was supplied.",
                        },
                    ],
                };
            }
            const params = {};
            if (uuid)
                params.uuid = uuid;
            if (tag)
                params.tag = tag;
            if (force)
                params.force = true;
            const result = await coolifyPost("/deploy", params, instance);
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
    // ── List Deployments (by application) ────────────────────────────
    server.registerTool("coolify_list_deployments", {
        title: "List Application Deployments",
        description: "List deployment history for a specific application. Returns status, commit, timestamps, and deployment UUIDs.",
        inputSchema: {
            uuid: z.string().min(1).describe("Application UUID"),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ uuid, instance }) => {
        try {
            const envelope = await coolifyGet(`/deployments/applications/${uuid}`, undefined, instance);
            const deployments = Array.isArray(envelope?.deployments) ? envelope.deployments : [];
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ count: envelope?.count ?? deployments.length, deployments }, null, 2),
                    },
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
    // ── Get Deployment ───────────────────────────────────────────────
    server.registerTool("coolify_get_deployment", {
        title: "Get Deployment Details",
        description: "Get full details and logs for a specific deployment by its deployment UUID.",
        inputSchema: {
            deployment_uuid: z
                .string()
                .min(1)
                .describe("The deployment UUID (not the application UUID)"),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ deployment_uuid, instance }) => {
        try {
            const deployment = await coolifyGet(`/deployments/${deployment_uuid}`, undefined, instance);
            return {
                content: [
                    { type: "text", text: JSON.stringify(deployment, null, 2) },
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
//# sourceMappingURL=deployments.js.map