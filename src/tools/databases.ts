/**
 * Database management tools for Coolify.
 *
 * Per Devon's standards:
 * - Flavor A: SQLite (no Coolify DB resource needed)
 * - Flavor B/C: PostgreSQL 16 as a separate Coolify database resource
 * - Redis only in Flavor C (part of docker-compose, not a standalone DB resource)
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
import { UuidSchema } from "../schemas/common.js";
import type { CoolifyDatabase } from "../types.js";

export function registerDatabaseTools(server: McpServer): void {
  // ── List Databases ───────────────────────────────────────────────

  server.registerTool(
    "coolify_list_databases",
    {
      title: "List Coolify Databases",
      description:
        "List all database resources managed by Coolify. Includes PostgreSQL, MySQL, MariaDB, MongoDB, Redis, etc.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const dbs = await coolifyGet<CoolifyDatabase[]>("/databases");
        return {
          content: [{ type: "text", text: JSON.stringify(dbs, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Get Database ─────────────────────────────────────────────────

  server.registerTool(
    "coolify_get_database",
    {
      title: "Get Coolify Database",
      description:
        "Get full details for a database resource by UUID — connection info, status, configuration.",
      inputSchema: { uuid: UuidSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uuid }: { uuid: string }) => {
      try {
        const db = await coolifyGet<CoolifyDatabase>(`/databases/${uuid}`);
        return {
          content: [{ type: "text", text: JSON.stringify(db, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Create Database ──────────────────────────────────────────────

  server.registerTool(
    "coolify_create_database",
    {
      title: "Create Coolify Database",
      description:
        "Create a new database resource. For Devon's Flavor B apps, this is typically PostgreSQL 16 " +
        "deployed on the same VPS. Supported types: postgresql, mysql, mariadb, mongodb, redis, keydb, clickhouse, dragonfly.",
      inputSchema: {
        project_uuid: z.string().min(1).describe("UUID of the target project"),
        environment_name: z
          .string()
          .default("production")
          .describe("Environment name"),
        server_uuid: z.string().min(1).describe("Server UUID"),
        destination_uuid: z.string().min(1).describe("Destination UUID"),
        type: z
          .enum([
            "postgresql",
            "mysql",
            "mariadb",
            "mongodb",
            "redis",
            "keydb",
            "clickhouse",
            "dragonfly",
          ])
          .describe("Database engine type"),
        name: z.string().optional().describe("Database display name"),
        description: z.string().optional().describe("Database description"),
        image: z
          .string()
          .optional()
          .describe("Docker image (e.g. postgres:16-alpine)"),
        is_public: z
          .boolean()
          .default(false)
          .describe("Expose publicly (default: false — internal only)"),
        public_port: z
          .number()
          .optional()
          .describe("Public port if is_public=true"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      project_uuid: string;
      environment_name: string;
      server_uuid: string;
      destination_uuid: string;
      type: string;
      name?: string;
      description?: string;
      image?: string;
      is_public: boolean;
      public_port?: number;
    }) => {
      try {
        const body: Record<string, unknown> = {
          project_uuid: params.project_uuid,
          environment_name: params.environment_name,
          server_uuid: params.server_uuid,
          destination_uuid: params.destination_uuid,
          type: params.type,
          is_public: params.is_public,
        };
        if (params.name) body.name = params.name;
        if (params.description) body.description = params.description;
        if (params.image) body.image = params.image;
        if (params.public_port !== undefined)
          body.public_port = params.public_port;

        const db = await coolifyPost<CoolifyDatabase>("/databases", body);
        return {
          content: [{ type: "text", text: JSON.stringify(db, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Update Database ──────────────────────────────────────────────

  server.registerTool(
    "coolify_update_database",
    {
      title: "Update Coolify Database",
      description: "Update a database resource's configuration.",
      inputSchema: {
        uuid: UuidSchema,
        name: z.string().optional().describe("New name"),
        description: z.string().optional().describe("New description"),
        image: z.string().optional().describe("New Docker image"),
        is_public: z.boolean().optional().describe("Toggle public access"),
        public_port: z.number().optional().describe("New public port"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Record<string, unknown>) => {
      try {
        const uuid = params.uuid as string;
        const body: Record<string, unknown> = {};
        for (const field of [
          "name",
          "description",
          "image",
          "is_public",
          "public_port",
        ]) {
          if (params[field] !== undefined) body[field] = params[field];
        }
        const db = await coolifyPatch<CoolifyDatabase>(
          `/databases/${uuid}`,
          body
        );
        return {
          content: [{ type: "text", text: JSON.stringify(db, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Delete Database ──────────────────────────────────────────────

  server.registerTool(
    "coolify_delete_database",
    {
      title: "Delete Coolify Database",
      description:
        "Delete a database resource. WARNING: This destroys the database and all its data.",
      inputSchema: {
        uuid: UuidSchema,
        delete_volumes: z
          .boolean()
          .default(true)
          .describe("Also delete data volumes (default: true)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      uuid,
      delete_volumes,
    }: {
      uuid: string;
      delete_volumes: boolean;
    }) => {
      try {
        await coolifyDelete(
          `/databases/${uuid}?delete_volumes=${delete_volumes}`
        );
        return {
          content: [
            { type: "text", text: `Database ${uuid} deleted successfully.` },
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
}
