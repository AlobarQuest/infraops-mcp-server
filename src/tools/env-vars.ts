/**
 * Environment Variable tools for Coolify.
 *
 * Manage env vars for applications and services.
 * Per Devon's standards: all secrets come from BWS and are injected as Coolify env vars.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  coolifyGet,
  coolifyPost,
  coolifyPatch,
  coolifyDelete,
  handleCoolifyError,
} from "../services/coolify-client.js";
import { UuidSchema, CoolifyInstanceSchema } from "../schemas/common.js";
import type { CoolifyInstance } from "../services/coolify-client.js";
import type { CoolifyEnvVar } from "../types.js";

export function registerEnvVarTools(server: McpServer): void {
  // ── List Env Vars (Application) ──────────────────────────────────

  server.registerTool(
    "coolify_list_app_envs",
    {
      title: "List Application Environment Variables",
      description:
        "List all environment variables for an application. Values of secrets may be masked by Coolify.",
      inputSchema: {
        uuid: z.string().min(1).describe("Application UUID"),
        reveal: z
          .boolean()
          .default(false)
          .describe("Return plaintext values (default: false — values are masked as ***)"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uuid, reveal, instance }: { uuid: string; reveal: boolean; instance: CoolifyInstance }) => {
      try {
        const envs = await coolifyGet<CoolifyEnvVar[]>(
          `/applications/${uuid}/envs`,
          undefined,
          instance
        );
        const output = reveal
          ? envs
          : envs.map((e) => ({ ...e, value: "***" }));
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Create Env Var (Application) ─────────────────────────────────

  server.registerTool(
    "coolify_create_app_env",
    {
      title: "Create Application Environment Variable",
      description:
        "Add a new environment variable to an application. " +
        "Remember: per infra standards, secrets should originate from BWS — this tool sets them in Coolify.",
      inputSchema: {
        uuid: z.string().min(1).describe("Application UUID"),
        key: z.string().min(1).describe("Variable name (e.g. DATABASE_URL)"),
        value: z.string().describe("Variable value"),
        is_buildtime: z
          .boolean()
          .default(false)
          .describe("Available during build phase (default: false). Use false for runtime-only vars like secrets."),
        is_runtime: z
          .boolean()
          .default(true)
          .describe("Available at runtime (default: true)"),
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
    },
    async (params: {
      uuid: string;
      key: string;
      value: string;
      is_buildtime: boolean;
      is_runtime: boolean;
      is_preview: boolean;
      instance: CoolifyInstance;
    }) => {
      try {
        const env = await coolifyPost<CoolifyEnvVar>(
          `/applications/${params.uuid}/envs`,
          {
            key: params.key,
            value: params.value,
            is_buildtime: params.is_buildtime,
            is_runtime: params.is_runtime,
            is_preview: params.is_preview,
          },
          params.instance
        );
        return {
          content: [{ type: "text", text: JSON.stringify(env, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Update Env Var (Application) ─────────────────────────────────
  // Coolify's update endpoint is PATCH /applications/{uuid}/envs with key+value
  // in the body — it updates by key name, not by env_uuid in the path.

  server.registerTool(
    "coolify_update_app_env",
    {
      title: "Update Application Environment Variable",
      description:
        "Update an existing environment variable on an application. " +
        "Coolify matches the var by key name — key and value are both required.",
      inputSchema: {
        uuid: z.string().min(1).describe("Application UUID"),
        key: z.string().min(1).describe("Variable name to update"),
        value: z.string().describe("New variable value"),
        is_buildtime: z.boolean().optional().describe("Build-time availability"),
        is_runtime: z.boolean().optional().describe("Runtime availability"),
        is_preview: z.boolean().optional().describe("Preview-only flag"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: {
      uuid: string;
      key: string;
      value: string;
      is_buildtime?: boolean;
      is_runtime?: boolean;
      is_preview?: boolean;
      instance: CoolifyInstance;
    }) => {
      try {
        const body: Record<string, unknown> = {
          key: params.key,
          value: params.value,
        };
        if (params.is_buildtime !== undefined) body.is_buildtime = params.is_buildtime;
        if (params.is_runtime !== undefined) body.is_runtime = params.is_runtime;
        if (params.is_preview !== undefined) body.is_preview = params.is_preview;

        const env = await coolifyPatch<CoolifyEnvVar>(
          `/applications/${params.uuid}/envs`,
          body,
          params.instance
        );
        return {
          content: [{ type: "text", text: JSON.stringify(env, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Delete Env Var (Application) ─────────────────────────────────

  server.registerTool(
    "coolify_delete_app_env",
    {
      title: "Delete Application Environment Variable",
      description:
        "Remove an environment variable from an application.",
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
    },
    async ({ uuid, env_uuid, instance }: { uuid: string; env_uuid: string; instance: CoolifyInstance }) => {
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
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Bulk Update Env Vars (Application) ──────────────────────────
  // Uses PATCH /applications/{uuid}/envs/bulk — creates or updates all vars
  // in a single API call. Coolify upserts: existing keys are updated, new keys
  // are created.

  server.registerTool(
    "coolify_bulk_create_app_envs",
    {
      title: "Bulk Create/Update Application Environment Variables",
      description:
        "Create or update multiple environment variables at once via a single API call. " +
        "Coolify upserts: existing keys are updated, new keys are created. " +
        "Useful when setting up a new application with all its required env vars from BWS.",
      inputSchema: {
        uuid: z.string().min(1).describe("Application UUID"),
        variables: z
          .array(
            z.object({
              key: z.string().min(1).describe("Variable name"),
              value: z.string().describe("Variable value"),
              is_buildtime: z.boolean().default(false).describe("Build-time flag"),
              is_runtime: z.boolean().default(true).describe("Runtime flag"),
              is_preview: z.boolean().default(false).describe("Preview-only flag"),
            })
          )
          .min(1)
          .describe("Array of env vars to create or update"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      uuid,
      variables,
      instance,
    }: {
      uuid: string;
      variables: Array<{
        key: string;
        value: string;
        is_buildtime: boolean;
        is_runtime: boolean;
        is_preview: boolean;
      }>;
      instance: CoolifyInstance;
    }) => {
      try {
        const result = await coolifyPatch(
          `/applications/${uuid}/envs/bulk`,
          { data: variables },
          instance
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── List Env Vars (Service) ──────────────────────────────────────

  server.registerTool(
    "coolify_list_service_envs",
    {
      title: "List Service Environment Variables",
      description:
        "List all environment variables for a Coolify service (Flavor C / docker-compose apps). " +
        "Use this for services deployed as docker-compose — NOT for single-container applications " +
        "(use coolify_list_app_envs for those).",
      inputSchema: {
        uuid: z.string().min(1).describe("Service UUID"),
        reveal: z
          .boolean()
          .default(false)
          .describe("Return plaintext values (default: false — values are masked as ***)"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uuid, reveal, instance }: { uuid: string; reveal: boolean; instance: CoolifyInstance }) => {
      try {
        const envs = await coolifyGet<CoolifyEnvVar[]>(
          `/services/${uuid}/envs`,
          undefined,
          instance
        );
        const output = reveal
          ? envs
          : envs.map((e) => ({ ...e, value: "***" }));
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Create Env Var (Service) ─────────────────────────────────────

  server.registerTool(
    "coolify_create_service_env",
    {
      title: "Create Service Environment Variable",
      description:
        "Add a new environment variable to a Coolify service (Flavor C / docker-compose apps). " +
        "Use this for multi-container compose services — NOT for single-container applications.",
      inputSchema: {
        uuid: z.string().min(1).describe("Service UUID"),
        key: z.string().min(1).describe("Variable name (e.g. DATABASE_URL)"),
        value: z.string().describe("Variable value"),
        is_buildtime: z
          .boolean()
          .default(false)
          .describe("Available during build phase (default: false)"),
        is_runtime: z
          .boolean()
          .default(true)
          .describe("Available at runtime (default: true)"),
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
    },
    async (params: {
      uuid: string;
      key: string;
      value: string;
      is_buildtime: boolean;
      is_runtime: boolean;
      is_preview: boolean;
      instance: CoolifyInstance;
    }) => {
      try {
        const env = await coolifyPost<CoolifyEnvVar>(
          `/services/${params.uuid}/envs`,
          {
            key: params.key,
            value: params.value,
            is_buildtime: params.is_buildtime,
            is_runtime: params.is_runtime,
            is_preview: params.is_preview,
          },
          params.instance
        );
        return {
          content: [{ type: "text", text: JSON.stringify(env, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Update Env Var (Service) ─────────────────────────────────────

  server.registerTool(
    "coolify_update_service_env",
    {
      title: "Update Service Environment Variable",
      description:
        "Update an existing environment variable on a Coolify service (Flavor C / docker-compose apps). " +
        "Coolify matches the var by key name. Use for multi-container compose services.",
      inputSchema: {
        uuid: z.string().min(1).describe("Service UUID"),
        key: z.string().min(1).describe("Variable name to update"),
        value: z.string().describe("New variable value"),
        is_buildtime: z.boolean().optional().describe("Build-time availability"),
        is_runtime: z.boolean().optional().describe("Runtime availability"),
        is_preview: z.boolean().optional().describe("Preview-only flag"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: {
      uuid: string;
      key: string;
      value: string;
      is_buildtime?: boolean;
      is_runtime?: boolean;
      is_preview?: boolean;
      instance: CoolifyInstance;
    }) => {
      try {
        const body: Record<string, unknown> = {
          key: params.key,
          value: params.value,
        };
        if (params.is_buildtime !== undefined) body.is_buildtime = params.is_buildtime;
        if (params.is_runtime !== undefined) body.is_runtime = params.is_runtime;
        if (params.is_preview !== undefined) body.is_preview = params.is_preview;

        const env = await coolifyPatch<CoolifyEnvVar>(
          `/services/${params.uuid}/envs`,
          body,
          params.instance
        );
        return {
          content: [{ type: "text", text: JSON.stringify(env, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Delete Env Var (Service) ─────────────────────────────────────

  server.registerTool(
    "coolify_delete_service_env",
    {
      title: "Delete Service Environment Variable",
      description:
        "Remove an environment variable from a Coolify service (docker-compose apps).",
      inputSchema: {
        uuid: z.string().min(1).describe("Service UUID"),
        env_uuid: z.string().min(1).describe("Environment variable UUID"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ uuid, env_uuid, instance }: { uuid: string; env_uuid: string; instance: CoolifyInstance }) => {
      try {
        await coolifyDelete(`/services/${uuid}/envs/${env_uuid}`, instance);
        return {
          content: [
            {
              type: "text",
              text: `Environment variable ${env_uuid} deleted from service ${uuid}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Bulk Update Env Vars (Service) ───────────────────────────────

  server.registerTool(
    "coolify_bulk_update_service_envs",
    {
      title: "Bulk Create/Update Service Environment Variables",
      description:
        "Create or update multiple environment variables at once for a Coolify service (docker-compose apps). " +
        "Coolify upserts: existing keys are updated, new keys are created. " +
        "Use for Flavor C apps (ContactHub, CRM, etc.) — NOT for single-container applications.",
      inputSchema: {
        uuid: z.string().min(1).describe("Service UUID"),
        variables: z
          .array(
            z.object({
              key: z.string().min(1).describe("Variable name"),
              value: z.string().describe("Variable value"),
              is_buildtime: z.boolean().default(false).describe("Build-time flag"),
              is_runtime: z.boolean().default(true).describe("Runtime flag"),
              is_preview: z.boolean().default(false).describe("Preview-only flag"),
            })
          )
          .min(1)
          .describe("Array of env vars to create or update"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      uuid,
      variables,
      instance,
    }: {
      uuid: string;
      variables: Array<{
        key: string;
        value: string;
        is_buildtime: boolean;
        is_runtime: boolean;
        is_preview: boolean;
      }>;
      instance: CoolifyInstance;
    }) => {
      try {
        const result = await coolifyPatch(
          `/services/${uuid}/envs/bulk`,
          { data: variables },
          instance
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );
}
