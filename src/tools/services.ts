/**
 * Service management tools for Coolify.
 *
 * Services in Coolify are Docker Compose-based multi-container workloads
 * or one-click service templates. For Devon's Flavor C apps, the
 * docker-compose.yml is deployed as a Coolify service.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  coolifyGet,
  coolifyPost,
  coolifyPatch,
  coolifyDelete,
  handleCoolifyError,
} from '../services/coolify-client.js';
import {
  UuidSchema,
  CoolifyInstanceSchema,
  CoolifyInstanceRequiredSchema,
} from '../schemas/common.js';
import type { CoolifyInstance } from '../services/coolify-client.js';
import { jsonResponse } from '../utils/response.js';
import { summarize, toServiceSummary } from '../utils/summaries.js';
import { maskSensitive } from '../utils/masking.js';
import type { CoolifyProject, CoolifyService } from '../types.js';

/**
 * Coolify's services API takes per-sub-service URLs, not a `domains` string:
 * `name` is the compose service (sub-application) name. An unknown body field
 * such as `domains` fails the whole request with "Validation failed".
 */
const ServiceUrlsSchema = z
  .array(
    z.object({
      name: z.string().min(1).describe('Compose service (sub-application) name, e.g. uptime-kuma'),
      url: z.string().min(1).describe('URL for that sub-service, e.g. http://kuma.local:3001'),
    }),
  )
  .optional()
  .describe('URLs per compose service, sent as Coolify `urls`');

type ServiceUrl = { name: string; url: string };

/**
 * Resolve the environment a service is created in. An omitted name resolves to
 * the project's only environment; any other miss lists the valid names, which
 * Coolify's own "Environment not found" does not.
 */
async function resolveEnvironmentName(
  projectUuid: string,
  requested: string | undefined,
  instance: CoolifyInstance,
): Promise<string> {
  const project = await coolifyGet<CoolifyProject>(`/projects/${projectUuid}`, undefined, instance);
  const names = (project.environments ?? []).map((e) => e.name);
  if (requested !== undefined) {
    if (names.includes(requested)) return requested;
    throw new Error(
      `Environment '${requested}' not found in project ${projectUuid}. Valid: ${names.join(', ') || '(none)'}`,
    );
  }
  if (names.length === 1) return names[0];
  throw new Error(
    `environment_name is required: project ${projectUuid} has ${names.length} environments (${names.join(', ') || 'none'})`,
  );
}

export function registerServiceTools(server: McpServer): void {
  // ── List Services ────────────────────────────────────────────────

  server.registerTool(
    'coolify_list_services',
    {
      title: 'List Coolify Services',
      description:
        'List all services (Docker Compose workloads) managed by Coolify. Compact summary by default; pass summary:false for full objects.',
      inputSchema: {
        summary: z
          .boolean()
          .default(true)
          .describe('Compact projection (default true); false for full objects'),
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
        const services = await coolifyGet<CoolifyService[]>('/services', undefined, instance);
        return jsonResponse(summarize(services as any[], toServiceSummary, summary));
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCoolifyError(error) }],
        };
      }
    },
  );

  // ── Get Service ──────────────────────────────────────────────────

  server.registerTool(
    'coolify_get_service',
    {
      title: 'Get Coolify Service',
      description:
        'Get full details for a service by UUID — includes compose config, status, and resource mapping. Webhook/basic-auth secrets are masked unless reveal:true.',
      inputSchema: {
        uuid: UuidSchema,
        reveal: z
          .boolean()
          .default(false)
          .describe('Reveal masked webhook/basic-auth secrets (default false)'),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      uuid,
      reveal,
      instance,
    }: {
      uuid: string;
      reveal: boolean;
      instance: CoolifyInstance;
    }) => {
      try {
        const svc = await coolifyGet<CoolifyService>(`/services/${uuid}`, undefined, instance);
        return jsonResponse(maskSensitive(svc as any, reveal));
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCoolifyError(error) }],
        };
      }
    },
  );

  // ── Create Service ───────────────────────────────────────────────

  server.registerTool(
    'coolify_create_service',
    {
      title: 'Create Coolify Service',
      description:
        'Create a new service from a Docker Compose definition or a one-click template. ' +
        "For Devon's Flavor C apps (like Contact Hub), supply the docker-compose.yml content.",
      inputSchema: {
        project_uuid: z.string().min(1).describe('UUID of the target project'),
        environment_name: z
          .string()
          .min(1)
          .optional()
          .describe("Environment name; omit to use the project's only environment"),
        server_uuid: z.string().min(1).describe('Server UUID'),
        destination_uuid: z
          .string()
          .min(1)
          .optional()
          .describe("Destination UUID; omit to use the server's only destination"),
        type: z
          .string()
          .describe(
            "Service type — use a one-click template name or 'docker-compose' for custom compose",
          ),
        name: z.string().optional().describe('Service display name'),
        description: z.string().optional().describe('Service description'),
        docker_compose_raw: z
          .string()
          .optional()
          .describe('Raw docker-compose.yml content (required if type is docker-compose)'),
        urls: ServiceUrlsSchema,
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
      environment_name?: string;
      server_uuid: string;
      destination_uuid?: string;
      type: string;
      name?: string;
      description?: string;
      docker_compose_raw?: string;
      urls?: ServiceUrl[];
      instance: CoolifyInstance;
    }) => {
      try {
        const body: Record<string, unknown> = {
          project_uuid: params.project_uuid,
          environment_name: await resolveEnvironmentName(
            params.project_uuid,
            params.environment_name,
            params.instance,
          ),
          server_uuid: params.server_uuid,
          type: params.type,
        };
        if (params.destination_uuid) body.destination_uuid = params.destination_uuid;
        if (params.name) body.name = params.name;
        if (params.description) body.description = params.description;
        if (params.docker_compose_raw) body.docker_compose_raw = params.docker_compose_raw;
        if (params.urls?.length) body.urls = params.urls;

        const svc = await coolifyPost<CoolifyService>('/services', body, params.instance);
        return {
          content: [{ type: 'text', text: JSON.stringify(svc, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCoolifyError(error) }],
        };
      }
    },
  );

  // ── Update Service ───────────────────────────────────────────────

  server.registerTool(
    'coolify_update_service',
    {
      title: 'Update Coolify Service',
      description: "Update a service's configuration.",
      inputSchema: {
        uuid: UuidSchema,
        name: z.string().optional().describe('New name'),
        description: z.string().optional().describe('New description'),
        docker_compose_raw: z.string().optional().describe('Updated docker-compose.yml content'),
        urls: ServiceUrlsSchema,
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
        for (const field of ['name', 'description', 'urls']) {
          if (params[field] !== undefined) body[field] = params[field];
        }
        if (params['docker_compose_raw'] !== undefined) {
          body.docker_compose_raw = Buffer.from(
            params['docker_compose_raw'] as string,
            'utf8',
          ).toString('base64');
        }
        const svc = await coolifyPatch<CoolifyService>(`/services/${uuid}`, body, instance);
        return {
          content: [{ type: 'text', text: JSON.stringify(svc, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCoolifyError(error) }],
        };
      }
    },
  );

  // ── Delete Service ───────────────────────────────────────────────

  server.registerTool(
    'coolify_delete_service',
    {
      title: 'Delete Coolify Service',
      description:
        'Delete a service. WARNING: Stops all containers and removes the service definition.',
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
          content: [{ type: 'text', text: `Service ${uuid} deleted successfully.` }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleCoolifyError(error) }],
        };
      }
    },
  );
}
