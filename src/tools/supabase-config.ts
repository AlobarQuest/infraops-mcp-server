/**
 * Supabase configuration tools for auth, secrets, and storage buckets.
 *
 * Covers:
 * - Auth config: get and update project auth settings
 * - Secrets: list, create, and delete project secrets
 * - Storage buckets: list, get, create, update, and delete buckets
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  supabaseGet,
  supabasePost,
  supabasePut,
  supabasePatch,
  supabaseDelete,
  handleSupabaseError,
} from '../services/supabase-client.js';

export function registerSupabaseConfigTools(server: McpServer): void {
  // ── Get Auth Config ───────────────────────────────────────────────

  server.registerTool(
    'supabase_get_auth_config',
    {
      title: 'Get Supabase Auth Config',
      description:
        'Get the authentication configuration for a Supabase project — site URL, JWT expiry, enabled providers, and other auth settings.',
      inputSchema: {
        ref: z.string().describe("Supabase project reference (e.g. 'abcdefghijklmnop')"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ref }: { ref: string }) => {
      try {
        const result = await supabaseGet<Record<string, unknown>>(`/projects/${ref}/config/auth`);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );

  // ── Update Auth Config ────────────────────────────────────────────

  server.registerTool(
    'supabase_update_auth_config',
    {
      title: 'Update Supabase Auth Config',
      description:
        'Update authentication configuration settings for a Supabase project. Common settings include site_url, jwt_expiry, external_email_enabled, and provider-specific options.',
      inputSchema: {
        ref: z.string().describe('Supabase project reference'),
        config: z
          .record(z.string(), z.unknown())
          .describe(
            'Auth configuration settings to update. Keys include site_url, jwt_expiry, external_email_enabled, disable_signup, and provider-specific settings.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ref, config }: { ref: string; config: Record<string, unknown> }) => {
      try {
        const result = await supabasePatch<Record<string, unknown>>(
          `/projects/${ref}/config/auth`,
          config,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );

  // ── List Secrets ──────────────────────────────────────────────────

  server.registerTool(
    'supabase_list_secrets',
    {
      title: 'List Supabase Project Secrets',
      description:
        'List all secrets (environment variables) stored for a Supabase project. Returns secret names only — values are not exposed.',
      inputSchema: {
        ref: z.string().describe('Supabase project reference'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ref }: { ref: string }) => {
      try {
        const result = await supabaseGet<Record<string, unknown>>(`/projects/${ref}/secrets`);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );

  // ── Create Secrets ────────────────────────────────────────────────

  server.registerTool(
    'supabase_create_secrets',
    {
      title: 'Create Supabase Project Secrets',
      description:
        'Create or update secrets (environment variables) for a Supabase project. These are available to Edge Functions as environment variables.',
      inputSchema: {
        ref: z.string().describe('Supabase project reference'),
        secrets: z
          .array(
            z.object({
              name: z.string().describe('Secret name (environment variable key)'),
              value: z.string().describe('Secret value'),
            }),
          )
          .describe('Array of secrets to create or update'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ref, secrets }: { ref: string; secrets: Array<{ name: string; value: string }> }) => {
      try {
        const result = await supabasePost<Record<string, unknown>>(
          `/projects/${ref}/secrets`,
          secrets,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );

  // ── Delete Secrets ────────────────────────────────────────────────

  server.registerTool(
    'supabase_delete_secrets',
    {
      title: 'Delete Supabase Project Secrets',
      description:
        'WARNING: Permanently deletes secrets from a Supabase project. Edge Functions that depend on deleted secrets will fail.',
      inputSchema: {
        ref: z.string().describe('Supabase project reference'),
        secrets: z.array(z.string()).describe('Array of secret names to delete'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ref, secrets }: { ref: string; secrets: string[] }) => {
      try {
        const result = await supabaseDelete<Record<string, unknown>>(
          `/projects/${ref}/secrets`,
          secrets,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );

  // ── List Storage Buckets ──────────────────────────────────────────

  server.registerTool(
    'supabase_list_storage_buckets',
    {
      title: 'List Supabase Storage Buckets',
      description:
        'List all storage buckets in a Supabase project. Returns bucket IDs, names, visibility (public/private), and configuration.',
      inputSchema: {
        ref: z.string().describe('Supabase project reference'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ref }: { ref: string }) => {
      try {
        const result = await supabaseGet<Record<string, unknown>>(
          `/projects/${ref}/storage/buckets`,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );

  // ── Get Storage Bucket ────────────────────────────────────────────

  server.registerTool(
    'supabase_get_storage_bucket',
    {
      title: 'Get Supabase Storage Bucket',
      description:
        'Get details for a specific storage bucket in a Supabase project — name, visibility, file size limit, and allowed MIME types.',
      inputSchema: {
        ref: z.string().describe('Supabase project reference'),
        bucket_id: z.string().describe('Storage bucket ID'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ref, bucket_id }: { ref: string; bucket_id: string }) => {
      try {
        const result = await supabaseGet<Record<string, unknown>>(
          `/projects/${ref}/storage/buckets/${bucket_id}`,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );

  // ── Create Storage Bucket ─────────────────────────────────────────

  server.registerTool(
    'supabase_create_storage_bucket',
    {
      title: 'Create Supabase Storage Bucket',
      description:
        'Create a new storage bucket in a Supabase project. Buckets are private by default; set public=true for publicly accessible files.',
      inputSchema: {
        ref: z.string().describe('Supabase project reference'),
        name: z.string().describe('Name of the bucket (also used as the bucket ID)'),
        public: z
          .boolean()
          .optional()
          .describe('Whether the bucket is publicly accessible. Defaults to false.'),
        file_size_limit: z
          .number()
          .optional()
          .describe('Maximum file size in bytes. No limit if not set.'),
        allowed_mime_types: z
          .array(z.string())
          .optional()
          .describe(
            "Allowed MIME types for uploads (e.g. ['image/png', 'image/jpeg']). All types allowed if not set.",
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
      ref: string;
      name: string;
      public?: boolean;
      file_size_limit?: number;
      allowed_mime_types?: string[];
    }) => {
      try {
        const body: Record<string, unknown> = { name: params.name };
        if (params.public !== undefined) body.public = params.public;
        if (params.file_size_limit !== undefined) body.file_size_limit = params.file_size_limit;
        if (params.allowed_mime_types !== undefined)
          body.allowed_mime_types = params.allowed_mime_types;

        const result = await supabasePost<Record<string, unknown>>(
          `/projects/${params.ref}/storage/buckets`,
          body,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );

  // ── Update Storage Bucket ─────────────────────────────────────────

  server.registerTool(
    'supabase_update_storage_bucket',
    {
      title: 'Update Supabase Storage Bucket',
      description:
        'Update configuration for an existing storage bucket — visibility, file size limit, and allowed MIME types.',
      inputSchema: {
        ref: z.string().describe('Supabase project reference'),
        bucket_id: z.string().describe('Storage bucket ID to update'),
        public: z.boolean().optional().describe('Whether the bucket should be publicly accessible'),
        file_size_limit: z
          .number()
          .optional()
          .describe('Maximum file size in bytes. Set to null to remove the limit.'),
        allowed_mime_types: z
          .array(z.string())
          .optional()
          .describe('Allowed MIME types for uploads. Set to empty array to allow all types.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      ref: string;
      bucket_id: string;
      public?: boolean;
      file_size_limit?: number;
      allowed_mime_types?: string[];
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.public !== undefined) body.public = params.public;
        if (params.file_size_limit !== undefined) body.file_size_limit = params.file_size_limit;
        if (params.allowed_mime_types !== undefined)
          body.allowed_mime_types = params.allowed_mime_types;

        const result = await supabasePut<Record<string, unknown>>(
          `/projects/${params.ref}/storage/buckets/${params.bucket_id}`,
          body,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );

  // ── Delete Storage Bucket ─────────────────────────────────────────

  server.registerTool(
    'supabase_delete_storage_bucket',
    {
      title: 'Delete Supabase Storage Bucket',
      description:
        'WARNING: Permanently deletes a storage bucket and all files within it. This action is irreversible.',
      inputSchema: {
        ref: z.string().describe('Supabase project reference'),
        bucket_id: z.string().describe('Storage bucket ID to delete'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ref, bucket_id }: { ref: string; bucket_id: string }) => {
      try {
        const result = await supabaseDelete<Record<string, unknown>>(
          `/projects/${ref}/storage/buckets/${bucket_id}`,
        );
        return {
          content: [
            {
              type: 'text',
              text: `Bucket ${bucket_id} deleted.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleSupabaseError(error) }],
        };
      }
    },
  );
}
