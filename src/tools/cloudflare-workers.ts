/**
 * Cloudflare Workers, KV, and D1 tools.
 *
 * Covers Workers inspection/deletion, KV namespace and key management,
 * and D1 database listing and querying.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  cloudflareGet,
  cloudflarePost,
  cloudflarePut,
  cloudflareDelete,
  handleCloudflareError,
  getAccountId,
} from "../services/cloudflare-client.js";

export function registerCloudflareWorkersTools(server: McpServer): void {
  // ── List Workers ─────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_list_workers",
    {
      title: "List Cloudflare Workers",
      description:
        "List all Worker scripts deployed in the Cloudflare account. Returns script names, modified dates, and usage model.",
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
        const accountId = getAccountId();
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${accountId}/workers/scripts`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Get Worker ───────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_get_worker",
    {
      title: "Get Cloudflare Worker",
      description:
        "Get details for a specific Worker script by name, including bindings, routes, and usage model.",
      inputSchema: {
        script_name: z.string().describe("Worker script name"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ script_name }: { script_name: string }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${accountId}/workers/scripts/${script_name}`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Delete Worker ────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_delete_worker",
    {
      title: "Delete Cloudflare Worker",
      description:
        "Permanently delete a Worker script by name. WARNING: This is irreversible and will remove all associated routes.",
      inputSchema: {
        script_name: z.string().describe("Worker script name to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ script_name }: { script_name: string }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflareDelete<Record<string, unknown>>(
          `/accounts/${accountId}/workers/scripts/${script_name}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Worker script '${script_name}' deleted.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── List KV Namespaces ───────────────────────────────────────────

  server.registerTool(
    "cloudflare_list_kv_namespaces",
    {
      title: "List Cloudflare KV Namespaces",
      description:
        "List all Workers KV namespaces in the Cloudflare account. Returns namespace IDs and titles.",
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
        const accountId = getAccountId();
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${accountId}/storage/kv/namespaces`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Create KV Namespace ──────────────────────────────────────────

  server.registerTool(
    "cloudflare_create_kv_namespace",
    {
      title: "Create Cloudflare KV Namespace",
      description:
        "Create a new Workers KV namespace with the given title. Returns the namespace ID.",
      inputSchema: {
        title: z.string().describe("Title for the new KV namespace"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ title }: { title: string }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflarePost<Record<string, unknown>>(
          `/accounts/${accountId}/storage/kv/namespaces`,
          { title }
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Delete KV Namespace ──────────────────────────────────────────

  server.registerTool(
    "cloudflare_delete_kv_namespace",
    {
      title: "Delete Cloudflare KV Namespace",
      description:
        "Permanently delete a Workers KV namespace and all its keys. WARNING: This is irreversible.",
      inputSchema: {
        namespace_id: z.string().describe("KV namespace ID to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ namespace_id }: { namespace_id: string }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflareDelete<Record<string, unknown>>(
          `/accounts/${accountId}/storage/kv/namespaces/${namespace_id}`
        );
        return {
          content: [
            {
              type: "text",
              text: `KV namespace '${namespace_id}' deleted.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── List KV Keys ─────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_list_kv_keys",
    {
      title: "List Cloudflare KV Keys",
      description:
        "List keys in a Workers KV namespace. Optionally filter by prefix and limit results.",
      inputSchema: {
        namespace_id: z.string().describe("KV namespace ID"),
        prefix: z
          .string()
          .optional()
          .describe("Filter keys by prefix"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of keys to return (default 1000, max 1000)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      namespace_id,
      prefix,
      limit,
    }: {
      namespace_id: string;
      prefix?: string;
      limit?: number;
    }) => {
      try {
        const accountId = getAccountId();
        const params: Record<string, unknown> = {};
        if (prefix) params.prefix = prefix;
        if (limit !== undefined) params.limit = limit;
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${accountId}/storage/kv/namespaces/${namespace_id}/keys`,
          params
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Get KV Value ─────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_get_kv_value",
    {
      title: "Get Cloudflare KV Value",
      description:
        "Get the value stored at a key in a Workers KV namespace. Returns raw text.",
      inputSchema: {
        namespace_id: z.string().describe("KV namespace ID"),
        key_name: z.string().describe("Key name to retrieve"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      namespace_id,
      key_name,
    }: {
      namespace_id: string;
      key_name: string;
    }) => {
      try {
        const accountId = getAccountId();
        // Returns raw text, not JSON
        const result = await cloudflareGet<string>(
          `/accounts/${accountId}/storage/kv/namespaces/${namespace_id}/values/${key_name}`
        );
        return {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Put KV Value ─────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_put_kv_value",
    {
      title: "Put Cloudflare KV Value",
      description:
        "Store a value at a key in a Workers KV namespace. Creates or overwrites the key.",
      inputSchema: {
        namespace_id: z.string().describe("KV namespace ID"),
        key_name: z.string().describe("Key name to set"),
        value: z.string().describe("Value to store at the key"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      namespace_id,
      key_name,
      value,
    }: {
      namespace_id: string;
      key_name: string;
      value: string;
    }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflarePut<Record<string, unknown>>(
          `/accounts/${accountId}/storage/kv/namespaces/${namespace_id}/values/${key_name}`,
          value as unknown as Record<string, unknown>
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Delete KV Value ──────────────────────────────────────────────

  server.registerTool(
    "cloudflare_delete_kv_value",
    {
      title: "Delete Cloudflare KV Value",
      description:
        "Delete a key and its value from a Workers KV namespace. WARNING: This is irreversible.",
      inputSchema: {
        namespace_id: z.string().describe("KV namespace ID"),
        key_name: z.string().describe("Key name to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      namespace_id,
      key_name,
    }: {
      namespace_id: string;
      key_name: string;
    }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflareDelete<Record<string, unknown>>(
          `/accounts/${accountId}/storage/kv/namespaces/${namespace_id}/values/${key_name}`
        );
        return {
          content: [
            {
              type: "text",
              text: `KV key '${key_name}' deleted from namespace '${namespace_id}'.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── List D1 Databases ────────────────────────────────────────────

  server.registerTool(
    "cloudflare_list_d1_databases",
    {
      title: "List Cloudflare D1 Databases",
      description:
        "List all D1 databases in the Cloudflare account. Returns database IDs, names, and versions.",
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
        const accountId = getAccountId();
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${accountId}/d1/database`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Query D1 Database ────────────────────────────────────────────

  server.registerTool(
    "cloudflare_query_d1",
    {
      title: "Query Cloudflare D1 Database",
      description:
        "Execute a SQL query against a Cloudflare D1 database. Accepts arbitrary SQL including DDL and DML. WARNING: Can modify or destroy data.",
      inputSchema: {
        database_id: z.string().describe("D1 database ID"),
        sql: z.string().describe("SQL query to execute"),
        params: z
          .array(z.unknown())
          .optional()
          .describe("Optional positional parameters for the SQL query"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      database_id,
      sql,
      params,
    }: {
      database_id: string;
      sql: string;
      params?: unknown[];
    }) => {
      try {
        const accountId = getAccountId();
        const body: Record<string, unknown> = { sql };
        if (params !== undefined) body.params = params;
        const result = await cloudflarePost<Record<string, unknown>>(
          `/accounts/${accountId}/d1/database/${database_id}/query`,
          body
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );
}
