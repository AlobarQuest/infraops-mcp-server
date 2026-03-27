/**
 * Server management tools for Coolify.
 *
 * Manage the underlying servers (VPS instances) that host Coolify resources.
 * Devon currently runs a single Hetzner VPS.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  coolifyGet,
  coolifyPost,
  coolifyDelete,
  handleCoolifyError,
  CoolifyInstance,
} from "../services/coolify-client.js";
import { UuidSchema, CoolifyInstanceSchema } from "../schemas/common.js";
import type { CoolifyServer } from "../types.js";

export function registerServerTools(server: McpServer): void {
  // ── List Servers ─────────────────────────────────────────────────

  server.registerTool(
    "coolify_list_servers",
    {
      title: "List Coolify Servers",
      description:
        "List all servers registered with Coolify. Returns name, IP, reachability status, and UUID for each.",
      inputSchema: { instance: CoolifyInstanceSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ instance }: { instance: CoolifyInstance }) => {
      try {
        const servers = await coolifyGet<CoolifyServer[]>("/servers", undefined, instance);
        return {
          content: [
            { type: "text", text: JSON.stringify(servers, null, 2) },
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

  // ── Get Server ───────────────────────────────────────────────────

  server.registerTool(
    "coolify_get_server",
    {
      title: "Get Coolify Server",
      description:
        "Get full details for a server by UUID — IP, settings, connectivity status, and validation logs.",
      inputSchema: { uuid: UuidSchema, instance: CoolifyInstanceSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uuid, instance }: { uuid: string; instance: CoolifyInstance }) => {
      try {
        const srv = await coolifyGet<CoolifyServer>(`/servers/${uuid}`, undefined, instance);
        return {
          content: [{ type: "text", text: JSON.stringify(srv, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Validate Server ──────────────────────────────────────────────

  server.registerTool(
    "coolify_validate_server",
    {
      title: "Validate Coolify Server",
      description:
        "Test SSH connectivity and Docker prerequisites for a server. " +
        "Use this to verify a server is properly connected before deploying resources.",
      inputSchema: { uuid: UuidSchema, instance: CoolifyInstanceSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uuid, instance }: { uuid: string; instance: CoolifyInstance }) => {
      try {
        const result = await coolifyGet<Record<string, unknown>>(
          `/servers/${uuid}/validate`, undefined, instance
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

  // ── Server Resources ─────────────────────────────────────────────

  server.registerTool(
    "coolify_server_resources",
    {
      title: "List Server Resources",
      description:
        "List all applications, databases, and services deployed on a specific server. " +
        "Great for getting a full inventory of what's running on your VPS.",
      inputSchema: { uuid: UuidSchema, instance: CoolifyInstanceSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uuid, instance }: { uuid: string; instance: CoolifyInstance }) => {
      try {
        const resources = await coolifyGet<Record<string, unknown>>(
          `/servers/${uuid}/resources`, undefined, instance
        );
        return {
          content: [
            { type: "text", text: JSON.stringify(resources, null, 2) },
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

  // ── Server Domains ───────────────────────────────────────────────

  server.registerTool(
    "coolify_server_domains",
    {
      title: "List Server Domains",
      description:
        "Retrieve all domain-to-resource mappings configured on a server. " +
        "Shows which apps are reachable at which FQDNs.",
      inputSchema: { uuid: UuidSchema, instance: CoolifyInstanceSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uuid, instance }: { uuid: string; instance: CoolifyInstance }) => {
      try {
        const domains = await coolifyGet<Record<string, unknown>>(
          `/servers/${uuid}/domains`, undefined, instance
        );
        return {
          content: [
            { type: "text", text: JSON.stringify(domains, null, 2) },
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
