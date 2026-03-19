/**
 * Application management tools for Coolify.
 *
 * Covers the full CRUD lifecycle plus logs retrieval.
 * Supports creation from: Docker Image, Dockerfile, Public Git, GitHub App.
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
import type { CoolifyApplication } from "../types.js";

export function registerApplicationTools(server: McpServer): void {
  // ── List Applications ────────────────────────────────────────────

  server.registerTool(
    "coolify_list_applications",
    {
      title: "List Coolify Applications",
      description:
        "List all applications across the Coolify instance. Returns UUID, name, FQDN, status, and build pack for each app.",
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
        const apps = await coolifyGet<CoolifyApplication[]>("/applications");
        return {
          content: [{ type: "text", text: JSON.stringify(apps, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Get Application ──────────────────────────────────────────────

  server.registerTool(
    "coolify_get_application",
    {
      title: "Get Coolify Application",
      description:
        "Get full details for a single application by UUID, including build config, health check settings, Git info, and deployment status.",
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
        const app = await coolifyGet<CoolifyApplication>(
          `/applications/${uuid}`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Create Application (Public Git) ──────────────────────────────

  server.registerTool(
    "coolify_create_application_public",
    {
      title: "Create Application from Public Git Repo",
      description:
        "Create a new application from a public Git repository. Suitable for open-source repos or public forks. " +
        "For Devon's Flavor A apps (Coolify source build).",
      inputSchema: {
        project_uuid: z.string().min(1).describe("UUID of the target project"),
        environment_name: z
          .string()
          .default("production")
          .describe("Environment name (default: production)"),
        server_uuid: z
          .string()
          .min(1)
          .describe("UUID of the destination server"),
        destination_uuid: z
          .string()
          .min(1)
          .describe(
            "UUID of the Docker network/destination on the server"
          ),
        git_repository: z
          .string()
          .min(1)
          .describe("Full Git repo URL (e.g. https://github.com/user/repo)"),
        git_branch: z
          .string()
          .default("main")
          .describe("Git branch to deploy (default: main)"),
        build_pack: z
          .enum(["nixpacks", "static", "dockerfile", "dockercompose"])
          .default("nixpacks")
          .describe("Build strategy"),
        name: z.string().optional().describe("Application display name"),
        description: z.string().optional().describe("Application description"),
        ports_exposes: z
          .string()
          .default("8080")
          .describe("Comma-separated ports to expose (default: 8080)"),
        domains: z
          .string()
          .optional()
          .describe(
            "FQDN for the app (e.g. https://myapp.devonwatkins.com)"
          ),
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
      git_repository: string;
      git_branch: string;
      build_pack: string;
      name?: string;
      description?: string;
      ports_exposes: string;
      domains?: string;
    }) => {
      try {
        const body: Record<string, unknown> = {
          project_uuid: params.project_uuid,
          environment_name: params.environment_name,
          server_uuid: params.server_uuid,
          destination_uuid: params.destination_uuid,
          git_repository: params.git_repository,
          git_branch: params.git_branch,
          build_pack: params.build_pack,
          ports_exposes: params.ports_exposes,
        };
        if (params.name) body.name = params.name;
        if (params.description) body.description = params.description;
        if (params.domains) body.domains = params.domains;

        const app = await coolifyPost<CoolifyApplication>(
          "/applications/public",
          body
        );
        return {
          content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Create Application (Docker Image) ────────────────────────────

  server.registerTool(
    "coolify_create_application_dockerimage",
    {
      title: "Create Application from Docker Image",
      description:
        "Create an application from a pre-built Docker image (e.g. from GHCR). " +
        "This is the standard pattern for Devon's Flavor B/C apps: GitHub Actions builds → pushes to ghcr.io/alobarquest/<app> → Coolify pulls.",
      inputSchema: {
        project_uuid: z.string().min(1).describe("UUID of the target project"),
        environment_name: z
          .string()
          .default("production")
          .describe("Environment name"),
        server_uuid: z
          .string()
          .min(1)
          .describe("UUID of the destination server"),
        destination_uuid: z
          .string()
          .min(1)
          .describe("UUID of the Docker network/destination"),
        docker_registry_image_name: z
          .string()
          .min(1)
          .describe(
            "Full image name (e.g. ghcr.io/alobarquest/myapp)"
          ),
        docker_registry_image_tag: z
          .string()
          .default("latest")
          .describe("Image tag (default: latest)"),
        name: z.string().optional().describe("Application display name"),
        description: z.string().optional().describe("Application description"),
        ports_exposes: z
          .string()
          .default("8000")
          .describe("Ports to expose (default: 8000)"),
        domains: z.string().optional().describe("FQDN for the app"),
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
      docker_registry_image_name: string;
      docker_registry_image_tag: string;
      name?: string;
      description?: string;
      ports_exposes: string;
      domains?: string;
    }) => {
      try {
        const body: Record<string, unknown> = {
          project_uuid: params.project_uuid,
          environment_name: params.environment_name,
          server_uuid: params.server_uuid,
          destination_uuid: params.destination_uuid,
          docker_registry_image_name: params.docker_registry_image_name,
          docker_registry_image_tag: params.docker_registry_image_tag,
          ports_exposes: params.ports_exposes,
        };
        if (params.name) body.name = params.name;
        if (params.description) body.description = params.description;
        if (params.domains) body.domains = params.domains;

        const app = await coolifyPost<CoolifyApplication>(
          "/applications/dockerimage",
          body
        );
        return {
          content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Create Application (Dockerfile) ──────────────────────────────

  server.registerTool(
    "coolify_create_application_dockerfile",
    {
      title: "Create Application from Inline Dockerfile",
      description:
        "Create an application using an inline Dockerfile (no Git repo required). " +
        "Useful for quick containerised deployments or testing.",
      inputSchema: {
        project_uuid: z.string().min(1).describe("UUID of the target project"),
        environment_name: z
          .string()
          .default("production")
          .describe("Environment name"),
        server_uuid: z.string().min(1).describe("Server UUID"),
        destination_uuid: z.string().min(1).describe("Destination UUID"),
        dockerfile: z
          .string()
          .min(1)
          .describe("Full Dockerfile content as a string"),
        name: z.string().optional().describe("Application display name"),
        description: z.string().optional().describe("Application description"),
        ports_exposes: z.string().default("8080").describe("Ports to expose"),
        domains: z.string().optional().describe("FQDN for the app"),
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
      dockerfile: string;
      name?: string;
      description?: string;
      ports_exposes: string;
      domains?: string;
    }) => {
      try {
        const body: Record<string, unknown> = {
          project_uuid: params.project_uuid,
          environment_name: params.environment_name,
          server_uuid: params.server_uuid,
          destination_uuid: params.destination_uuid,
          dockerfile: params.dockerfile,
          ports_exposes: params.ports_exposes,
        };
        if (params.name) body.name = params.name;
        if (params.description) body.description = params.description;
        if (params.domains) body.domains = params.domains;

        const app = await coolifyPost<CoolifyApplication>(
          "/applications/dockerfile",
          body
        );
        return {
          content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Update Application ───────────────────────────────────────────

  server.registerTool(
    "coolify_update_application",
    {
      title: "Update Coolify Application",
      description:
        "Update an application's configuration. Supports changing name, description, domains, " +
        "Git settings, build pack, health check config, ports, and more. Only supply the fields you want to change.",
      inputSchema: {
        uuid: UuidSchema,
        name: z.string().optional().describe("New application name"),
        description: z.string().optional().describe("New description"),
        domains: z
          .string()
          .optional()
          .describe("New FQDN (e.g. https://app.devonwatkins.com)"),
        git_repository: z.string().optional().describe("New Git repo URL"),
        git_branch: z.string().optional().describe("New Git branch"),
        build_pack: z
          .enum(["nixpacks", "static", "dockerfile", "dockercompose"])
          .optional()
          .describe("New build strategy"),
        docker_registry_image_name: z
          .string()
          .optional()
          .describe("New Docker image name"),
        docker_registry_image_tag: z
          .string()
          .optional()
          .describe("New Docker image tag"),
        ports_exposes: z.string().optional().describe("New exposed ports"),
        health_check_enabled: z
          .boolean()
          .optional()
          .describe("Enable/disable health checks"),
        health_check_path: z
          .string()
          .optional()
          .describe("Health check endpoint path"),
        health_check_port: z
          .string()
          .optional()
          .describe("Health check port"),
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
        const fields = [
          "name",
          "description",
          "domains",
          "git_repository",
          "git_branch",
          "build_pack",
          "docker_registry_image_name",
          "docker_registry_image_tag",
          "ports_exposes",
          "health_check_enabled",
          "health_check_path",
          "health_check_port",
        ];
        for (const field of fields) {
          if (params[field] !== undefined) body[field] = params[field];
        }

        const app = await coolifyPatch<CoolifyApplication>(
          `/applications/${uuid}`,
          body
        );
        return {
          content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Delete Application ───────────────────────────────────────────

  server.registerTool(
    "coolify_delete_application",
    {
      title: "Delete Coolify Application",
      description:
        "Permanently delete an application by UUID. This stops the app and removes all associated resources.",
      inputSchema: {
        uuid: UuidSchema,
        delete_configurations: z
          .boolean()
          .default(true)
          .describe("Also delete persistent storage/configs (default: true)"),
        delete_volumes: z
          .boolean()
          .default(true)
          .describe("Also delete Docker volumes (default: true)"),
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
      delete_configurations,
      delete_volumes,
    }: {
      uuid: string;
      delete_configurations: boolean;
      delete_volumes: boolean;
    }) => {
      try {
        await coolifyDelete(
          `/applications/${uuid}?delete_configurations=${delete_configurations}&delete_volumes=${delete_volumes}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Application ${uuid} deleted successfully.`,
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

  // ── Application Logs ─────────────────────────────────────────────

  server.registerTool(
    "coolify_application_logs",
    {
      title: "Get Application Logs",
      description:
        "Retrieve recent logs for an application. Useful for debugging deployment failures or runtime errors.",
      inputSchema: {
        uuid: UuidSchema,
        lines: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe("Number of log lines to retrieve (default: 100)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uuid, lines }: { uuid: string; lines: number }) => {
      try {
        const logs = await coolifyGet<string>(
          `/applications/${uuid}/logs`,
          { lines }
        );
        return {
          content: [
            {
              type: "text",
              text:
                typeof logs === "string" ? logs : JSON.stringify(logs, null, 2),
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
}
