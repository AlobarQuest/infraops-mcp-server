/**
 * Control tools for Coolify — start, stop, restart any resource.
 *
 * Works for applications, databases, and services.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CoolifyInstanceSchema, CoolifyInstanceRequiredSchema } from '../schemas/common.js';
import {
  coolifyPost,
  coolifyGet,
  coolifyPatch,
  handleCoolifyError,
  CoolifyInstance,
} from '../services/coolify-client.js';
import { jsonResponse } from '../utils/response.js';
import {
  summarize,
  toServerSummary,
  toProjectSummary,
  toApplicationSummary,
  toDatabaseSummary,
  toServiceSummary,
} from '../utils/summaries.js';

const ResourceTypeSchema = z
  .enum(['applications', 'databases', 'services'])
  .describe('Resource type: applications, databases, or services');

const ActionSchema = z.enum(['start', 'stop', 'restart']).describe('Action to perform');

export function registerControlTools(server: McpServer): void {
  // ── Start/Stop/Restart ───────────────────────────────────────────

  server.registerTool(
    'coolify_control',
    {
      title: 'Control Coolify Resource',
      description:
        'Start, stop, or restart an application, database, or service. ' +
        'This is the universal control tool — use it for lifecycle management of any Coolify resource.',
      inputSchema: {
        resource_type: ResourceTypeSchema,
        uuid: z.string().min(1).describe('UUID of the resource'),
        action: ActionSchema,
        instance: CoolifyInstanceRequiredSchema,
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
            instance,
          );
        } catch {
          result = await coolifyGet<Record<string, unknown>>(
            `/${resource_type}/${uuid}/${action}`,
            undefined,
            instance,
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: `${action} command sent to ${resource_type.slice(0, -1)} ${uuid}.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCoolifyError(error) }],
        };
      }
    },
  );

  // ── Reset Custom Labels ────────────────────────────────────────────

  server.registerTool(
    'coolify_reset_labels',
    {
      title: 'Reset Coolify Application Labels',
      description:
        'Clear custom_labels on an application so Coolify auto-generates Traefik labels from the current domain config. ' +
        'Use this after changing domains to fix stale routing rules. Optionally triggers a redeploy.',
      inputSchema: {
        uuid: z.string().min(1).describe('Application UUID'),
        redeploy: z
          .boolean()
          .default(true)
          .describe('Trigger a redeploy after clearing labels (default: true)'),
        instance: CoolifyInstanceRequiredSchema,
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
          { custom_labels: '' },
          instance,
        );

        let msg = `Custom labels cleared for application ${uuid}. Coolify will auto-generate labels on next deploy.`;

        // Optionally trigger a full deploy (not restart) so Coolify regenerates labels
        if (redeploy) {
          try {
            await coolifyPost<Record<string, unknown>>(
              `/applications/${uuid}/deploy`,
              {},
              instance,
            );
            msg +=
              '\nDeploy triggered — Coolify will regenerate labels from current domain config.';
          } catch {
            msg +=
              '\nNote: deploy trigger failed — you may need to deploy manually via coolify_deploy.';
          }
        }

        return {
          content: [{ type: 'text', text: msg }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCoolifyError(error) }],
        };
      }
    },
  );

  // ── Get Version ──────────────────────────────────────────────────

  server.registerTool(
    'coolify_version',
    {
      title: 'Get Coolify Version',
      description:
        'Returns the Coolify instance version. Useful for verifying connectivity and API compatibility.',
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
        const version = await coolifyGet<string>('/version', undefined, instance);
        return {
          content: [
            {
              type: 'text',
              text: typeof version === 'string' ? version : JSON.stringify(version),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCoolifyError(error) }],
        };
      }
    },
  );

  // ── Infrastructure Overview ──────────────────────────────────────

  server.registerTool(
    'coolify_overview',
    {
      title: 'Coolify Infrastructure Overview',
      description:
        'Get a comprehensive snapshot of all servers, projects, applications, databases, and services. ' +
        'This is the best starting point when you need to understand the current state of the infrastructure.',
      inputSchema: {
        summary: z
          .boolean()
          .default(true)
          .describe(
            'Project each resource to its essential fields (default true). false returns full ' +
              'objects for every resource and can be very large.',
          ),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ summary, instance }: { summary: boolean; instance: CoolifyInstance }) => {
      try {
        // Gather all top-level resources in parallel
        const [servers, projects, applications, databases, services] = await Promise.all([
          coolifyGet<any[]>('/servers', undefined, instance).catch(() => []),
          coolifyGet<any[]>('/projects', undefined, instance).catch(() => []),
          coolifyGet<any[]>('/applications', undefined, instance).catch(() => []),
          coolifyGet<any[]>('/databases', undefined, instance).catch(() => []),
          coolifyGet<any[]>('/services', undefined, instance).catch(() => []),
        ]);

        const overview = {
          summary: {
            servers: Array.isArray(servers) ? servers.length : 0,
            projects: Array.isArray(projects) ? projects.length : 0,
            applications: Array.isArray(applications) ? applications.length : 0,
            databases: Array.isArray(databases) ? databases.length : 0,
            services: Array.isArray(services) ? services.length : 0,
          },
          servers: summarize(servers, toServerSummary, summary),
          projects: summarize(projects, toProjectSummary, summary),
          applications: summarize(applications, toApplicationSummary, summary),
          databases: summarize(databases, toDatabaseSummary, summary),
          services: summarize(services, toServiceSummary, summary),
        };

        return jsonResponse(overview);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCoolifyError(error) }],
        };
      }
    },
  );
}
