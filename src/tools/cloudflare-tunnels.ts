/**
 * Cloudflare Tunnel management tools.
 *
 * Covers tunnel lifecycle and configuration:
 * list tunnels, get tunnel, create tunnel, delete tunnel,
 * get tunnel config, update tunnel config.
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

export function registerCloudflareTunnelTools(server: McpServer): void {
  // ── List Tunnels ─────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_list_tunnels",
    {
      title: "List Cloudflare Tunnels",
      description:
        "List all Cloudflare Tunnels in the account. Returns tunnel IDs, names, statuses, and connection information.",
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
          `/accounts/${accountId}/cfd_tunnel`
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

  // ── Get Tunnel ───────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_get_tunnel",
    {
      title: "Get Cloudflare Tunnel",
      description:
        "Get full details for a specific Cloudflare Tunnel by ID — name, status, connections, and metadata.",
      inputSchema: {
        tunnel_id: z.string().describe("Cloudflare Tunnel ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ tunnel_id }: { tunnel_id: string }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${accountId}/cfd_tunnel/${tunnel_id}`
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

  // ── Create Tunnel ────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_create_tunnel",
    {
      title: "Create Cloudflare Tunnel",
      description:
        "Create a new Cloudflare Tunnel. Returns the tunnel ID and token needed to run the connector.",
      inputSchema: {
        name: z.string().describe("Name for the tunnel"),
        tunnel_secret: z
          .string()
          .describe(
            "Base64-encoded 32+ byte secret used to authenticate the tunnel connector"
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, tunnel_secret }: { name: string; tunnel_secret: string }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflarePost<Record<string, unknown>>(
          `/accounts/${accountId}/cfd_tunnel`,
          { name, tunnel_secret }
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

  // ── Delete Tunnel ────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_delete_tunnel",
    {
      title: "Delete Cloudflare Tunnel",
      description:
        "Permanently delete a Cloudflare Tunnel. WARNING: This is irreversible and will disconnect all active connections.",
      inputSchema: {
        tunnel_id: z.string().describe("Cloudflare Tunnel ID to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ tunnel_id }: { tunnel_id: string }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflareDelete<Record<string, unknown>>(
          `/accounts/${accountId}/cfd_tunnel/${tunnel_id}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Tunnel ${tunnel_id} deleted.\n${JSON.stringify(result, null, 2)}`,
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

  // ── Get Tunnel Config ────────────────────────────────────────────

  server.registerTool(
    "cloudflare_get_tunnel_config",
    {
      title: "Get Cloudflare Tunnel Config",
      description:
        "Get the ingress configuration for a Cloudflare Tunnel — hostname routing rules, services, and paths.",
      inputSchema: {
        tunnel_id: z.string().describe("Cloudflare Tunnel ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ tunnel_id }: { tunnel_id: string }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${accountId}/cfd_tunnel/${tunnel_id}/configurations`
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

  // ── Update Tunnel Config ─────────────────────────────────────────

  server.registerTool(
    "cloudflare_update_tunnel_config",
    {
      title: "Update Cloudflare Tunnel Config",
      description:
        "Replace the ingress configuration for a Cloudflare Tunnel. The last ingress rule must be a catch-all with no hostname.",
      inputSchema: {
        tunnel_id: z.string().describe("Cloudflare Tunnel ID"),
        config: z
          .object({
            ingress: z
              .array(
                z.object({
                  service: z.string().describe("Backend service URL (e.g. 'http://localhost:8080')"),
                  hostname: z
                    .string()
                    .optional()
                    .describe("Public hostname to route (e.g. 'app.example.com'). Omit for catch-all rule."),
                  path: z
                    .string()
                    .optional()
                    .describe("URL path prefix to match (e.g. '/api'). Optional."),
                })
              )
              .describe("Ordered list of ingress rules. Last rule must be a catch-all (no hostname)."),
          })
          .describe("Tunnel configuration object containing ingress rules"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      tunnel_id: string;
      config: {
        ingress: Array<{
          service: string;
          hostname?: string;
          path?: string;
        }>;
      };
    }) => {
      try {
        const accountId = getAccountId();
        const result = await cloudflarePut<Record<string, unknown>>(
          `/accounts/${accountId}/cfd_tunnel/${params.tunnel_id}/configurations`,
          { config: params.config }
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
