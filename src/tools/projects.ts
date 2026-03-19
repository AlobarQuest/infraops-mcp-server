/**
 * Project & Environment tools for Coolify.
 *
 * Projects are the top-level organisational unit in Coolify.
 * Each project contains one or more environments (e.g. production, staging).
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
import type { CoolifyProject, CoolifyEnvironment } from "../types.js";

export function registerProjectTools(server: McpServer): void {
  // ── List Projects ────────────────────────────────────────────────

  server.registerTool(
    "coolify_list_projects",
    {
      title: "List Coolify Projects",
      description:
        "List all projects in the Coolify instance. Projects are the top-level organisational unit — each contains environments which in turn contain applications, databases, and services.",
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
        const projects = await coolifyGet<CoolifyProject[]>("/projects");
        return {
          content: [
            { type: "text", text: JSON.stringify(projects, null, 2) },
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

  // ── Get Project ──────────────────────────────────────────────────

  server.registerTool(
    "coolify_get_project",
    {
      title: "Get Coolify Project",
      description:
        "Get full details for a single project by UUID, including its environments and the resources within them.",
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
        const project = await coolifyGet<CoolifyProject>(
          `/projects/${uuid}`
        );
        return {
          content: [
            { type: "text", text: JSON.stringify(project, null, 2) },
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

  // ── Create Project ───────────────────────────────────────────────

  server.registerTool(
    "coolify_create_project",
    {
      title: "Create Coolify Project",
      description:
        "Create a new project. After creation, add environments to it, then deploy applications/databases/services into those environments.",
      inputSchema: {
        name: z.string().min(1).describe("Project name"),
        description: z
          .string()
          .optional()
          .describe("Optional project description"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      name,
      description,
    }: {
      name: string;
      description?: string;
    }) => {
      try {
        const project = await coolifyPost<CoolifyProject>("/projects", {
          name,
          ...(description ? { description } : {}),
        });
        return {
          content: [
            { type: "text", text: JSON.stringify(project, null, 2) },
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

  // ── Update Project ───────────────────────────────────────────────

  server.registerTool(
    "coolify_update_project",
    {
      title: "Update Coolify Project",
      description: "Update a project's name or description.",
      inputSchema: {
        uuid: UuidSchema,
        name: z.string().optional().describe("New project name"),
        description: z
          .string()
          .optional()
          .describe("New project description"),
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
      name,
      description,
    }: {
      uuid: string;
      name?: string;
      description?: string;
    }) => {
      try {
        const data: Record<string, unknown> = {};
        if (name !== undefined) data.name = name;
        if (description !== undefined) data.description = description;

        const project = await coolifyPatch<CoolifyProject>(
          `/projects/${uuid}`,
          data
        );
        return {
          content: [
            { type: "text", text: JSON.stringify(project, null, 2) },
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

  // ── Delete Project ───────────────────────────────────────────────

  server.registerTool(
    "coolify_delete_project",
    {
      title: "Delete Coolify Project",
      description:
        "Delete a project by UUID. WARNING: This will delete all environments and resources within the project.",
      inputSchema: { uuid: UuidSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ uuid }: { uuid: string }) => {
      try {
        await coolifyDelete(`/projects/${uuid}`);
        return {
          content: [
            {
              type: "text",
              text: `Project ${uuid} deleted successfully.`,
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

  // ── List Environments ────────────────────────────────────────────

  server.registerTool(
    "coolify_list_environments",
    {
      title: "List Project Environments",
      description:
        "List all environments within a project. Environments separate resources (e.g. production vs staging).",
      inputSchema: {
        project_uuid: z
          .string()
          .min(1)
          .describe("UUID of the parent project"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ project_uuid }: { project_uuid: string }) => {
      try {
        // Environments are typically nested in the project response
        const project = await coolifyGet<CoolifyProject>(
          `/projects/${project_uuid}`
        );
        const environments = project.environments ?? [];
        return {
          content: [
            { type: "text", text: JSON.stringify(environments, null, 2) },
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

  // ── Create Environment ───────────────────────────────────────────

  server.registerTool(
    "coolify_create_environment",
    {
      title: "Create Project Environment",
      description:
        "Create a new environment within a project (e.g. 'production', 'staging', 'preview').",
      inputSchema: {
        project_uuid: z
          .string()
          .min(1)
          .describe("UUID of the parent project"),
        name: z
          .string()
          .min(1)
          .describe("Environment name (e.g. production, staging)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      project_uuid,
      name,
    }: {
      project_uuid: string;
      name: string;
    }) => {
      try {
        const env = await coolifyPost<CoolifyEnvironment>(
          `/projects/${project_uuid}/environments`,
          { name }
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

  // ── Delete Environment ───────────────────────────────────────────

  server.registerTool(
    "coolify_delete_environment",
    {
      title: "Delete Project Environment",
      description:
        "Delete an environment from a project. WARNING: All resources in this environment will be removed.",
      inputSchema: {
        project_uuid: z
          .string()
          .min(1)
          .describe("UUID of the parent project"),
        environment_name: z
          .string()
          .min(1)
          .describe("Name of the environment to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      project_uuid,
      environment_name,
    }: {
      project_uuid: string;
      environment_name: string;
    }) => {
      try {
        await coolifyDelete(
          `/projects/${project_uuid}/${environment_name}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Environment '${environment_name}' deleted from project ${project_uuid}.`,
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
