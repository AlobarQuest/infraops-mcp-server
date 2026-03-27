/**
 * Environment Variable tools for Coolify.
 *
 * Manage env vars for applications and services.
 * Per Devon's standards: all secrets come from BWS and are injected as Coolify env vars.
 */
import { z } from "zod";
import { coolifyGet, coolifyPost, coolifyPatch, coolifyDelete, handleCoolifyError, } from "../services/coolify-client.js";
import { CoolifyInstanceSchema } from "../schemas/common.js";
export function registerEnvVarTools(server) {
    // ── List Env Vars (Application) ──────────────────────────────────
    server.registerTool("coolify_list_app_envs", {
        title: "List Application Environment Variables",
        description: "List all environment variables for an application. Values of secrets may be masked by Coolify.",
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
            const envs = await coolifyGet(`/applications/${uuid}/envs`, undefined, instance);
            return {
                content: [{ type: "text", text: JSON.stringify(envs, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Create Env Var (Application) ─────────────────────────────────
    server.registerTool("coolify_create_app_env", {
        title: "Create Application Environment Variable",
        description: "Add a new environment variable to an application. " +
            "Remember: per infra standards, secrets should originate from BWS — this tool sets them in Coolify.",
        inputSchema: {
            uuid: z.string().min(1).describe("Application UUID"),
            key: z.string().min(1).describe("Variable name (e.g. DATABASE_URL)"),
            value: z.string().describe("Variable value"),
            is_build_time: z
                .boolean()
                .default(false)
                .describe("Available during build phase (default: false)"),
            is_preview: z
                .boolean()
                .default(false)
                .describe("Only for preview deployments (default: false)"),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const env = await coolifyPost(`/applications/${params.uuid}/envs`, {
                key: params.key,
                value: params.value,
                is_build_time: params.is_build_time,
                is_preview: params.is_preview,
            }, params.instance);
            return {
                content: [{ type: "text", text: JSON.stringify(env, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Update Env Var (Application) ─────────────────────────────────
    server.registerTool("coolify_update_app_env", {
        title: "Update Application Environment Variable",
        description: "Update an existing environment variable on an application. Supply only the fields to change.",
        inputSchema: {
            uuid: z.string().min(1).describe("Application UUID"),
            env_uuid: z.string().min(1).describe("Environment variable UUID"),
            key: z.string().optional().describe("New variable name"),
            value: z.string().optional().describe("New variable value"),
            is_build_time: z.boolean().optional().describe("Build-time availability"),
            is_preview: z.boolean().optional().describe("Preview-only flag"),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const body = {};
            if (params.key !== undefined)
                body.key = params.key;
            if (params.value !== undefined)
                body.value = params.value;
            if (params.is_build_time !== undefined)
                body.is_build_time = params.is_build_time;
            if (params.is_preview !== undefined)
                body.is_preview = params.is_preview;
            const env = await coolifyPatch(`/applications/${params.uuid}/envs/${params.env_uuid}`, body, params.instance);
            return {
                content: [{ type: "text", text: JSON.stringify(env, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: handleCoolifyError(error) }],
            };
        }
    });
    // ── Delete Env Var (Application) ─────────────────────────────────
    server.registerTool("coolify_delete_app_env", {
        title: "Delete Application Environment Variable",
        description: "Remove an environment variable from an application.",
        inputSchema: {
            uuid: z.string().min(1).describe("Application UUID"),
            env_uuid: z.string().min(1).describe("Environment variable UUID"),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ uuid, env_uuid, instance }) => {
        try {
            await coolifyDelete(`/applications/${uuid}/envs/${env_uuid}`, instance);
            return {
                content: [
                    {
                        type: "text",
                        text: `Environment variable ${env_uuid} deleted from application ${uuid}.`,
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
    // ── Bulk Create Env Vars ─────────────────────────────────────────
    server.registerTool("coolify_bulk_create_app_envs", {
        title: "Bulk Create Application Environment Variables",
        description: "Create multiple environment variables at once. Useful when setting up a new application " +
            "with all its required env vars from BWS.",
        inputSchema: {
            uuid: z.string().min(1).describe("Application UUID"),
            variables: z
                .array(z.object({
                key: z.string().min(1).describe("Variable name"),
                value: z.string().describe("Variable value"),
                is_build_time: z.boolean().default(false).describe("Build-time flag"),
                is_preview: z.boolean().default(false).describe("Preview-only flag"),
            }))
                .min(1)
                .describe("Array of env vars to create"),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ uuid, variables, instance, }) => {
        try {
            const results = [];
            for (const v of variables) {
                try {
                    await coolifyPost(`/applications/${uuid}/envs`, {
                        key: v.key,
                        value: v.value,
                        is_build_time: v.is_build_time,
                        is_preview: v.is_preview,
                    }, instance);
                    results.push({ key: v.key, status: "created" });
                }
                catch (err) {
                    results.push({
                        key: v.key,
                        status: "failed",
                        error: handleCoolifyError(err),
                    });
                }
            }
            return {
                content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
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
//# sourceMappingURL=env-vars.js.map