/**
 * Control tools for Coolify — start, stop, restart any resource.
 *
 * Works for applications, databases, and services.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  coolifyPost,
  coolifyGet,
  handleCoolifyError,
} from "../services/coolify-client.js";

const ResourceTypeSchema = z
  .enum(["applications", "databases", "services"])
  .describe("Resource type: applications, databases, or services");

const ActionSchema = z
  .enum(["start", "stop", "restart"])
  .describe("Action to perform");

export function registerControlTools(server: McpServer): void {
  // ── Start/Stop/Restart ───────────────────────────────────────────

  server.registerTool(
    "coolify_control",
    {
      title: "Control Coolify Resource",
      description:
        "Start, stop, or restart an application, database, or service. " +
        "This is the universal control tool — use it for lifecycle management of any Coolify resource.",
      inputSchema: {
        resource_type: ResourceTypeSchema,
        uuid: z.string().min(1).describe("UUID of the resource"),
        action: ActionSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      resource_type,
      uuid,
      action,
    }: {
      resource_type: string;
      uuid: string;
      action: string;
    }) => {
      try {
        // Coolify API uses GET or POST for start/stop/restart depending on version
        // Try POST first (newer API), fall back to GET
        let result: Record<string, unknown>;
        try {
          result = await coolifyPost<Record<string, unknown>>(
            `/${resource_type}/${uuid}/${action}`,
            {}
          );
        } catch {
          result = await coolifyGet<Record<string, unknown>>(
            `/${resource_type}/${uuid}/${action}`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: `${action} command sent to ${resource_type.slice(0, -1)} ${uuid}.\n${JSON.stringify(result, null, 2)}`,
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

  // ── Get Version ──────────────────────────────────────────────────

  server.registerTool(
    "coolify_version",
    {
      title: "Get Coolify Version",
      description:
        "Returns the Coolify instance version. Useful for verifying connectivity and API compatibility.",
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
        const version = await coolifyGet<string>("/version");
        return {
          content: [
            {
              type: "text",
              text:
                typeof version === "string"
                  ? version
                  : JSON.stringify(version),
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

  // ── Infrastructure Overview ──────────────────────────────────────

  server.registerTool(
    "coolify_overview",
    {
      title: "Coolify Infrastructure Overview",
      description:
        "Get a comprehensive snapshot of all servers, projects, applications, databases, and services. " +
        "This is the best starting point when you need to understand the current state of the infrastructure.",
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
        // Gather all top-level resources in parallel
        const [servers, projects, applications, databases, services] =
          await Promise.all([
            coolifyGet<unknown[]>("/servers").catch(() => []),
            coolifyGet<unknown[]>("/projects").catch(() => []),
            coolifyGet<unknown[]>("/applications").catch(() => []),
            coolifyGet<unknown[]>("/databases").catch(() => []),
            coolifyGet<unknown[]>("/services").catch(() => []),
          ]);

        const overview = {
          summary: {
            servers: Array.isArray(servers) ? servers.length : 0,
            projects: Array.isArray(projects) ? projects.length : 0,
            applications: Array.isArray(applications) ? applications.length : 0,
            databases: Array.isArray(databases) ? databases.length : 0,
            services: Array.isArray(services) ? services.length : 0,
          },
          servers,
          projects,
          applications,
          databases,
          services,
        };

        return {
          content: [
            { type: "text", text: JSON.stringify(overview, null, 2) },
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
