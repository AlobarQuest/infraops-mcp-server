/**
 * Control tools for Coolify — start, stop, restart any resource.
 *
 * Works for applications, databases, and services.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CoolifyInstanceSchema } from "../schemas/common.js";
import {
  coolifyPost,
  coolifyGet,
  coolifyPatch,
  handleCoolifyError,
  CoolifyInstance,
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
      resource_type,
      uuid,
      action,
      instance,
    }: {
      resource_type: string;
      uuid: string;
      action: string;
      instance: CoolifyInstance;
    }) => {
      try {
        // Coolify API uses GET or POST for start/stop/restart depending on version
        // Try POST first (newer API), fall back to GET
        let result: Record<string, unknown>;
        try {
          result = await coolifyPost<Record<string, unknown>>(
            `/${resource_type}/${uuid}/${action}`,
            {},
            instance
          );
        } catch {
          result = await coolifyGet<Record<string, unknown>>(
            `/${resource_type}/${uuid}/${action}`,
            undefined,
            instance
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

  // ── Reset Custom Labels ────────────────────────────────────────────

  server.registerTool(
    "coolify_reset_labels",
    {
      title: "Reset Coolify Application Labels",
      description:
        "Clear custom_labels on an application so Coolify auto-generates Traefik labels from the current domain config. " +
        "Use this after changing domains to fix stale routing rules. Optionally triggers a redeploy.",
      inputSchema: {
        uuid: z.string().min(1).describe("Application UUID"),
        redeploy: z
          .boolean()
          .default(true)
          .describe("Trigger a redeploy after clearing labels (default: true)"),
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
      redeploy,
      instance,
    }: {
      uuid: string;
      redeploy: boolean;
      instance: CoolifyInstance;
    }) => {
      try {
        // Clear custom_labels
        await coolifyPatch<Record<string, unknown>>(
          `/applications/${uuid}`,
          { custom_labels: "" },
          instance
        );

        let msg = `Custom labels cleared for application ${uuid}. Coolify will auto-generate labels on next deploy.`;

        // Optionally trigger a full deploy (not restart) so Coolify regenerates labels
        if (redeploy) {
          try {
            await coolifyPost<Record<string, unknown>>(
              `/applications/${uuid}/deploy`,
              {},
              instance
            );
            msg += "\nDeploy triggered — Coolify will regenerate labels from current domain config.";
          } catch {
            msg += "\nNote: deploy trigger failed — you may need to deploy manually via coolify_deploy.";
          }
        }

        return {
          content: [{ type: "text", text: msg }],
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
      inputSchema: {
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ instance }: { instance: CoolifyInstance }) => {
      try {
        const version = await coolifyGet<string>("/version", undefined, instance);
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
      inputSchema: {
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ instance }: { instance: CoolifyInstance }) => {
      try {
        // Gather all top-level resources in parallel
        const [servers, projects, applications, databases, services] =
          await Promise.all([
            coolifyGet<unknown[]>("/servers", undefined, instance).catch(() => []),
            coolifyGet<unknown[]>("/projects", undefined, instance).catch(() => []),
            coolifyGet<unknown[]>("/applications", undefined, instance).catch(() => []),
            coolifyGet<unknown[]>("/databases", undefined, instance).catch(() => []),
            coolifyGet<unknown[]>("/services", undefined, instance).catch(() => []),
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
