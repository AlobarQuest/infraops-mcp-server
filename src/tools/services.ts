/**
 * Service management tools for Coolify.
 *
 * Services in Coolify are Docker Compose-based multi-container workloads
 * or one-click service templates. For Devon's Flavor C apps, the
 * docker-compose.yml is deployed as a Coolify service.
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
import { UuidSchema, CoolifyInstanceSchema, CoolifyInstanceRequiredSchema } from "../schemas/common.js";
import type { CoolifyInstance } from "../services/coolify-client.js";
import type { CoolifyService } from "../types.js";

export function registerServiceTools(server: McpServer): void {
  // ── List Services ────────────────────────────────────────────────

  server.registerTool(
    "coolify_list_services",
    {
      title: "List Coolify Services",
      description:
        "List all services (Docker Compose workloads) managed by Coolify.",
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
        const services = await coolifyGet<CoolifyService[]>("/services", undefined, instance);
        return {
          content: [
            { type: "text", text: JSON.stringify(services, null, 2) },
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

  // ── Get Service ──────────────────────────────────────────────────

  server.registerTool(
    "coolify_get_service",
    {
      title: "Get Coolify Service",
      description:
        "Get full details for a service by UUID — includes compose config, status, and resource mapping.",
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
        const svc = await coolifyGet<CoolifyService>(`/services/${uuid}`, undefined, instance);
        return {
          content: [{ type: "text", text: JSON.stringify(svc, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Create Service ───────────────────────────────────────────────

  server.registerTool(
    "coolify_create_service",
    {
      title: "Create Coolify Service",
      description:
        "Create a new service from a Docker Compose definition or a one-click template. " +
        "For Devon's Flavor C apps (like Contact Hub), supply the docker-compose.yml content.",
      inputSchema: {
        project_uuid: z.string().min(1).describe("UUID of the target project"),
        environment_name: z
          .string()
          .default("production")
          .describe("Environment name"),
        server_uuid: z.string().min(1).describe("Server UUID"),
        destination_uuid: z.string().min(1).describe("Destination UUID"),
        type: z
          .string()
          .describe(
            "Service type — use a one-click template name or 'docker-compose' for custom compose"
          ),
        name: z.string().optional().describe("Service display name"),
        description: z.string().optional().describe("Service description"),
        docker_compose_raw: z
          .string()
          .optional()
          .describe(
            "Raw docker-compose.yml content (required if type is docker-compose)"
          ),
        domains: z.string().optional().describe("FQDN for the service"),
        instance: CoolifyInstanceRequiredSchema,
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
      docker_compose_raw?: string;
      domains?: string;
      instance: CoolifyInstance;
    }) => {
      try {
        const body: Record<string, unknown> = {
          project_uuid: params.project_uuid,
          environment_name: params.environment_name,
          server_uuid: params.server_uuid,
          destination_uuid: params.destination_uuid,
          type: params.type,
        };
        if (params.name) body.name = params.name;
        if (params.description) body.description = params.description;
        if (params.docker_compose_raw)
          body.docker_compose_raw = params.docker_compose_raw;
        if (params.domains) body.domains = params.domains;

        const svc = await coolifyPost<CoolifyService>("/services", body, params.instance);
        return {
          content: [{ type: "text", text: JSON.stringify(svc, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Update Service ───────────────────────────────────────────────

  server.registerTool(
    "coolify_update_service",
    {
      title: "Update Coolify Service",
      description: "Update a service's configuration.",
      inputSchema: {
        uuid: UuidSchema,
        name: z.string().optional().describe("New name"),
        description: z.string().optional().describe("New description"),
        docker_compose_raw: z
          .string()
          .optional()
          .describe("Updated docker-compose.yml content"),
        domains: z.string().optional().describe("New FQDN"),
        instance: CoolifyInstanceRequiredSchema,
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
        const instance = params.instance as CoolifyInstance;
        const body: Record<string, unknown> = {};
        for (const field of ["name", "description", "domains"]) {
          if (params[field] !== undefined) body[field] = params[field];
        }
        if (params["docker_compose_raw"] !== undefined) {
          body.docker_compose_raw = Buffer.from(
            params["docker_compose_raw"] as string,
            "utf8"
          ).toString("base64");
        }
        const svc = await coolifyPatch<CoolifyService>(
          `/services/${uuid}`,
          body,
          instance
        );
        return {
          content: [{ type: "text", text: JSON.stringify(svc, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Delete Service ───────────────────────────────────────────────

  server.registerTool(
    "coolify_delete_service",
    {
      title: "Delete Coolify Service",
      description:
        "Delete a service. WARNING: Stops all containers and removes the service definition.",
      inputSchema: { uuid: UuidSchema, instance: CoolifyInstanceRequiredSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ uuid, instance }: { uuid: string; instance: CoolifyInstance }) => {
      try {
        await coolifyDelete(`/services/${uuid}`, instance);
        return {
          content: [
            { type: "text", text: `Service ${uuid} deleted successfully.` },
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
