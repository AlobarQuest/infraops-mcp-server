/**
 * Application management tools for Coolify.
 *
 * Covers the full CRUD lifecycle plus logs retrieval.
 * Supports all 6 Coolify deployment types:
 *   Git-based:    Public Repository, Private Repository (GitHub App), Private Repository (Deploy Key)
 *   Docker-based: Dockerfile, Docker Compose (Empty), Docker Image
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import {
  coolifyGet,
  coolifyPost,
  coolifyPatch,
  coolifyDelete,
  handleCoolifyError,
} from "../services/coolify-client.js";
import { UuidSchema, CoolifyInstanceSchema } from "../schemas/common.js";
import type { CoolifyInstance } from "../services/coolify-client.js";
import type { CoolifyApplication } from "../types.js";

export function registerApplicationTools(server: McpServer): void {
  // ── List Applications ────────────────────────────────────────────

  server.registerTool(
    "coolify_list_applications",
    {
      title: "List Coolify Applications",
      description:
        "List all applications across the Coolify instance. Returns UUID, name, FQDN, status, and build pack for each app.",
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
        const apps = await coolifyGet<CoolifyApplication[]>("/applications", undefined, instance);
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
        const app = await coolifyGet<CoolifyApplication>(
          `/applications/${uuid}`, undefined, instance
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

  // ── Git: Public Repository ───────────────────────────────────────

  server.registerTool(
    "coolify_create_application_public",
    {
      title: "Create Application — Public Repository",
      description:
        "Create an application from a public Git repository. " +
        "You can deploy any kind of public repo from supported Git providers. " +
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
      instance: CoolifyInstance;
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
          body,
          params.instance
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

  // ── Docker: Docker Image ─────────────────────────────────────────

  server.registerTool(
    "coolify_create_application_dockerimage",
    {
      title: "Create Application — Docker Image",
      description:
        "Create an application from any Docker registry without Git. " +
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
      instance: CoolifyInstance;
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
          body,
          params.instance
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

  // ── Docker: Dockerfile ───────────────────────────────────────────

  server.registerTool(
    "coolify_create_application_dockerfile",
    {
      title: "Create Application — Dockerfile",
      description:
        "Create an application from a Dockerfile without Git. " +
        "You can deploy a simple Dockerfile by providing its content directly.",
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
      project_uuid: string;
      environment_name: string;
      server_uuid: string;
      destination_uuid: string;
      dockerfile: string;
      name?: string;
      description?: string;
      ports_exposes: string;
      domains?: string;
      instance: CoolifyInstance;
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
          body,
          params.instance
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

  // ── Git: Private Repository (Deploy Key) ─────────────────────────

  server.registerTool(
    "coolify_create_application_deploykey",
    {
      title: "Create Application — Private Repository (Deploy Key)",
      description:
        "Create an application from a private Git repository with a deploy key. " +
        "You can deploy private repos with a deploy key. " +
        "Requires a private key already stored in Coolify (via coolify_create_private_key) " +
        "and the public key added to GitHub (via github_add_deploy_key).",
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
          .describe("UUID of the Docker network/destination on the server"),
        private_key_uuid: z
          .string()
          .min(1)
          .describe("UUID of the Coolify private key (from coolify_create_private_key)"),
        git_repository: z
          .string()
          .min(1)
          .describe("Git SSH URL (e.g. 'git@github.com:AlobarQuest/my-app.git') — must be SSH format for deploy key auth"),
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
          .default("8000")
          .describe("Comma-separated ports to expose (default: 8000)"),
        domains: z
          .string()
          .optional()
          .describe("FQDN for single-container apps (not for dockercompose — use coolify_set_compose_config instead)"),
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
      project_uuid: string;
      environment_name: string;
      server_uuid: string;
      destination_uuid: string;
      private_key_uuid: string;
      git_repository: string;
      git_branch: string;
      build_pack: string;
      name?: string;
      description?: string;
      ports_exposes: string;
      domains?: string;
      instance: CoolifyInstance;
    }) => {
      try {
        const body: Record<string, unknown> = {
          project_uuid: params.project_uuid,
          environment_name: params.environment_name,
          server_uuid: params.server_uuid,
          destination_uuid: params.destination_uuid,
          private_key_uuid: params.private_key_uuid,
          git_repository: params.git_repository,
          git_branch: params.git_branch,
          build_pack: params.build_pack,
          ports_exposes: params.ports_exposes,
        };
        if (params.name) body.name = params.name;
        if (params.description) body.description = params.description;
        if (params.domains) body.domains = params.domains;

        const app = await coolifyPost<CoolifyApplication>(
          "/applications/private-deploy-key",
          body,
          params.instance
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

  // ── Git: Private Repository (GitHub App) ──────────────────────────

  server.registerTool(
    "coolify_create_application_githubapp",
    {
      title: "Create Application — Private Repository (GitHub App)",
      description:
        "Create an application from a private Git repository using a GitHub App. " +
        "You can deploy public and private repos through your GitHub Apps. " +
        "Requires a GitHub App already configured in Coolify.",
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
          .describe("UUID of the Docker network/destination on the server"),
        github_app_uuid: z
          .string()
          .min(1)
          .describe("UUID of the GitHub App configured in Coolify"),
        git_repository: z
          .string()
          .min(1)
          .describe("Git repo URL (e.g. 'https://github.com/user/repo')"),
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
          .default("8000")
          .describe("Comma-separated ports to expose (default: 8000)"),
        domains: z
          .string()
          .optional()
          .describe("FQDN for single-container apps (not for dockercompose — use coolify_set_compose_config instead)"),
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
      project_uuid: string;
      environment_name: string;
      server_uuid: string;
      destination_uuid: string;
      github_app_uuid: string;
      git_repository: string;
      git_branch: string;
      build_pack: string;
      name?: string;
      description?: string;
      ports_exposes: string;
      domains?: string;
      instance: CoolifyInstance;
    }) => {
      try {
        const body: Record<string, unknown> = {
          project_uuid: params.project_uuid,
          environment_name: params.environment_name,
          server_uuid: params.server_uuid,
          destination_uuid: params.destination_uuid,
          github_app_uuid: params.github_app_uuid,
          git_repository: params.git_repository,
          git_branch: params.git_branch,
          build_pack: params.build_pack,
          ports_exposes: params.ports_exposes,
        };
        if (params.name) body.name = params.name;
        if (params.description) body.description = params.description;
        if (params.domains) body.domains = params.domains;

        const app = await coolifyPost<CoolifyApplication>(
          "/applications/private-github-app",
          body,
          params.instance
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

  // ── Docker: Docker Compose (Empty) ────────────────────────────────

  server.registerTool(
    "coolify_create_application_dockercompose",
    {
      title: "Create Application — Docker Compose (Empty)",
      description:
        "Create a Docker Compose application without Git. " +
        "You can deploy complex applications easily with Docker Compose by providing the raw compose file content directly. " +
        "Note: Coolify marks this endpoint as deprecated in favor of /services, but it remains available in the UI.",
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
          .optional()
          .describe("UUID of the Docker network/destination on the server"),
        docker_compose_raw: z
          .string()
          .min(1)
          .describe("Full docker-compose.yml content as a string"),
        name: z.string().optional().describe("Application display name"),
        description: z.string().optional().describe("Application description"),
        instant_deploy: z
          .boolean()
          .default(false)
          .describe("Deploy immediately after creation (default: false)"),
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
      project_uuid: string;
      environment_name: string;
      server_uuid: string;
      destination_uuid?: string;
      docker_compose_raw: string;
      name?: string;
      description?: string;
      instant_deploy: boolean;
      instance: CoolifyInstance;
    }) => {
      try {
        const body: Record<string, unknown> = {
          project_uuid: params.project_uuid,
          environment_name: params.environment_name,
          server_uuid: params.server_uuid,
          docker_compose_raw: params.docker_compose_raw,
          instant_deploy: params.instant_deploy,
        };
        if (params.destination_uuid) body.destination_uuid = params.destination_uuid;
        if (params.name) body.name = params.name;
        if (params.description) body.description = params.description;

        const app = await coolifyPost<CoolifyApplication>(
          "/applications/dockercompose",
          body,
          params.instance
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

  // ── Set Compose Config ────────────────────────────────────────────

  server.registerTool(
    "coolify_set_compose_config",
    {
      title: "Set Docker Compose Configuration",
      description:
        "Configure compose-specific fields for a dockercompose application: domain-to-service mapping, " +
        "compose file location, and optionally clear stale custom_labels. " +
        "This is required after creating a compose app to set up Traefik routing.",
      inputSchema: {
        uuid: UuidSchema,
        docker_compose_domains: z
          .array(
            z.object({
              name: z.string().describe("Compose service name (e.g. 'api')"),
              domain: z.string().describe("Domain URL(s), comma-separated (e.g. 'https://app.devonwatkins.com')"),
            })
          )
          .optional()
          .describe("Service-to-domain mapping for Traefik routing"),
        docker_compose_location: z
          .string()
          .default("/docker-compose.yml")
          .describe("Path to compose file in the repo (default: /docker-compose.yml)"),
        reset_labels: z
          .boolean()
          .default(true)
          .describe("Clear custom_labels so Coolify auto-generates from domain config (default: true)"),
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
      docker_compose_domains?: Array<{ name: string; domain: string }>;
      docker_compose_location: string;
      reset_labels: boolean;
      instance: CoolifyInstance;
    }) => {
      try {
        const body: Record<string, unknown> = {
          docker_compose_location: params.docker_compose_location,
        };
        if (params.docker_compose_domains) {
          body.docker_compose_domains = params.docker_compose_domains;
        }
        if (params.reset_labels) {
          body.custom_labels = "";
        }

        const app = await coolifyPatch<CoolifyApplication>(
          `/applications/${params.uuid}`,
          body,
          params.instance
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
        health_check_start_period: z
          .number()
          .int()
          .optional()
          .describe("Health check start period in seconds (e.g. 15)"),
        docker_compose_location: z
          .string()
          .optional()
          .describe("Path to compose file in the repo (e.g. /docker-compose.yml)"),
        docker_compose_domains: z
          .array(
            z.object({
              name: z.string().describe("Compose service name"),
              domain: z.string().describe("Domain URL(s), comma-separated"),
            })
          )
          .optional()
          .describe("Service-to-domain mapping for compose apps"),
        custom_labels: z
          .string()
          .nullable()
          .optional()
          .describe("Custom Traefik labels (set to empty string to reset/auto-generate)"),
        private_key_uuid: z
          .string()
          .optional()
          .describe("UUID of Coolify private key to link for Git access"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Record<string, unknown> & { instance: CoolifyInstance }) => {
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
          "health_check_start_period",
          "docker_compose_location",
          "docker_compose_domains",
          "custom_labels",
          "private_key_uuid",
        ];
        for (const field of fields) {
          if (params[field] !== undefined) body[field] = params[field];
        }

        const app = await coolifyPatch<CoolifyApplication>(
          `/applications/${uuid}`,
          body,
          params.instance
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
        instance: CoolifyInstanceSchema,
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
      instance,
    }: {
      uuid: string;
      delete_configurations: boolean;
      delete_volumes: boolean;
      instance: CoolifyInstance;
    }) => {
      try {
        await coolifyDelete(
          `/applications/${uuid}?delete_configurations=${delete_configurations}&delete_volumes=${delete_volumes}`,
          instance
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
        "Retrieve recent logs for an application by its UUID. " +
        "Returns an informational message (not an error) if the application is stopped. " +
        "Requires: uuid (application UUID, not service UUID — use vps_docker_logs for compose services).",
      inputSchema: {
        uuid: UuidSchema,
        lines: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe("Number of log lines to retrieve (default: 100)"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ uuid, lines, instance }: { uuid: string; lines: number; instance: CoolifyInstance }) => {
      try {
        const logs = await coolifyGet<string>(
          `/applications/${uuid}/logs`,
          { lines },
          instance
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
        // 400 = app is stopped/not running — informational, not a hard error
        if (axios.isAxiosError(error) && error.response?.status === 400) {
          const msg = error.response?.data?.message as string | undefined;
          const suffix = msg && msg !== "Application is not running." ? ` ${msg}` : "";
          return {
            content: [
              {
                type: "text",
                text: `Application ${uuid} is not running — no logs available.${suffix}`,
              },
            ],
          };
        }
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );
}
