/**
 * Cloudflare Pages management tools.
 *
 * Covers Pages project and deployment management:
 * list projects, get project, create project, update project, delete project,
 * list deployments, get deployment, create deployment.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  cloudflareGet,
  cloudflarePost,
  cloudflarePatch,
  cloudflareDelete,
  handleCloudflareError,
  getAccountId,
} from '../services/cloudflare-client.js';

export function registerCloudflarePagesTools(server: McpServer): void {
  // ── List Pages Projects ───────────────────────────────────────────

  server.registerTool(
    'cloudflare_list_pages_projects',
    {
      title: 'List Cloudflare Pages Projects',
      description:
        'List all Cloudflare Pages projects in the account. Returns project names, domains, production branch, and deployment status.',
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
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${getAccountId()}/pages/projects`,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCloudflareError(error) }],
        };
      }
    },
  );

  // ── Get Pages Project ─────────────────────────────────────────────

  server.registerTool(
    'cloudflare_get_pages_project',
    {
      title: 'Get Cloudflare Pages Project',
      description:
        'Get full details for a Cloudflare Pages project by name — domains, build config, deployment config, and latest deployment info.',
      inputSchema: {
        project_name: z.string().describe('Pages project name'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ project_name }: { project_name: string }) => {
      try {
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${getAccountId()}/pages/projects/${project_name}`,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCloudflareError(error) }],
        };
      }
    },
  );

  // ── Create Pages Project ──────────────────────────────────────────

  server.registerTool(
    'cloudflare_create_pages_project',
    {
      title: 'Create Cloudflare Pages Project',
      description:
        'Create a new Cloudflare Pages project. Returns the created project with its ID and deployment configuration.',
      inputSchema: {
        name: z.string().describe('Pages project name (must be unique in the account)'),
        production_branch: z.string().describe("Git branch to treat as production (e.g. 'main')"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, production_branch }: { name: string; production_branch: string }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          production_branch,
        };
        const result = await cloudflarePost<Record<string, unknown>>(
          `/accounts/${getAccountId()}/pages/projects`,
          body,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCloudflareError(error) }],
        };
      }
    },
  );

  // ── Update Pages Project ──────────────────────────────────────────

  server.registerTool(
    'cloudflare_update_pages_project',
    {
      title: 'Update Cloudflare Pages Project',
      description:
        'Update settings for an existing Cloudflare Pages project, such as production branch or build configuration.',
      inputSchema: {
        project_name: z.string().describe('Pages project name to update'),
        production_branch: z.string().optional().describe('New production branch name'),
        build_config: z
          .object({
            build_command: z.string().optional().describe("Build command (e.g. 'npm run build')"),
            destination_dir: z
              .string()
              .optional()
              .describe("Output directory for build artifacts (e.g. 'dist')"),
            root_dir: z
              .string()
              .optional()
              .describe('Root directory of the project relative to the repo root'),
          })
          .optional()
          .describe('Build configuration settings'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      project_name: string;
      production_branch?: string;
      build_config?: {
        build_command?: string;
        destination_dir?: string;
        root_dir?: string;
      };
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.production_branch !== undefined)
          body.production_branch = params.production_branch;
        if (params.build_config !== undefined) body.build_config = params.build_config;

        const result = await cloudflarePatch<Record<string, unknown>>(
          `/accounts/${getAccountId()}/pages/projects/${params.project_name}`,
          body,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCloudflareError(error) }],
        };
      }
    },
  );

  // ── Delete Pages Project ──────────────────────────────────────────

  server.registerTool(
    'cloudflare_delete_pages_project',
    {
      title: 'Delete Cloudflare Pages Project',
      description:
        'Permanently delete a Cloudflare Pages project and all its deployments. WARNING: This is irreversible.',
      inputSchema: {
        project_name: z.string().describe('Pages project name to delete'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ project_name }: { project_name: string }) => {
      try {
        const result = await cloudflareDelete<Record<string, unknown>>(
          `/accounts/${getAccountId()}/pages/projects/${project_name}`,
        );
        return {
          content: [
            {
              type: 'text',
              text: `Pages project '${project_name}' deleted.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCloudflareError(error) }],
        };
      }
    },
  );

  // ── List Pages Deployments ────────────────────────────────────────

  server.registerTool(
    'cloudflare_list_pages_deployments',
    {
      title: 'List Cloudflare Pages Deployments',
      description:
        'List all deployments for a Cloudflare Pages project. Returns deployment IDs, status, branch, commit info, and timestamps.',
      inputSchema: {
        project_name: z.string().describe('Pages project name'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ project_name }: { project_name: string }) => {
      try {
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${getAccountId()}/pages/projects/${project_name}/deployments`,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCloudflareError(error) }],
        };
      }
    },
  );

  // ── Get Pages Deployment ──────────────────────────────────────────

  server.registerTool(
    'cloudflare_get_pages_deployment',
    {
      title: 'Get Cloudflare Pages Deployment',
      description:
        'Get full details for a specific Cloudflare Pages deployment — status, build log URL, environment, and deployment URL.',
      inputSchema: {
        project_name: z.string().describe('Pages project name'),
        deployment_id: z.string().describe('Deployment ID'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ project_name, deployment_id }: { project_name: string; deployment_id: string }) => {
      try {
        const result = await cloudflareGet<Record<string, unknown>>(
          `/accounts/${getAccountId()}/pages/projects/${project_name}/deployments/${deployment_id}`,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCloudflareError(error) }],
        };
      }
    },
  );

  // ── Create Pages Deployment ───────────────────────────────────────

  server.registerTool(
    'cloudflare_create_pages_deployment',
    {
      title: 'Create Cloudflare Pages Deployment',
      description:
        'Trigger a new deployment for a Cloudflare Pages project. Optionally specify a branch to deploy from.',
      inputSchema: {
        project_name: z.string().describe('Pages project name'),
        branch: z
          .string()
          .optional()
          .describe('Branch to deploy (defaults to production branch if omitted)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ project_name, branch }: { project_name: string; branch?: string }) => {
      try {
        const body: Record<string, unknown> = {};
        if (branch !== undefined) body.branch = branch;

        const result = await cloudflarePost<Record<string, unknown>>(
          `/accounts/${getAccountId()}/pages/projects/${project_name}/deployments`,
          body,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCloudflareError(error) }],
        };
      }
    },
  );
}
