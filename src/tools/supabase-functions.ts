/**
 * Supabase Edge Functions management tools.
 *
 * Covers Edge Function CRUD operations:
 * list functions, get function, create function,
 * update function, and delete function.
 *
 * Note: The Supabase Edge Functions API may require multipart form upload
 * for the function body in some versions. This implementation uses JSON body —
 * adjust to multipart if needed at runtime.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  supabaseGet,
  supabasePost,
  supabasePatch,
  supabaseDelete,
  handleSupabaseError,
} from '../services/supabase-client.js';

export function registerSupabaseFunctionTools(server: McpServer): void {
  // ── List Functions ────────────────────────────────────────────────

  server.registerTool(
    'supabase_list_functions',
    {
      title: 'List Supabase Edge Functions',
      description:
        'List all Edge Functions deployed to a Supabase project. Returns function slugs, names, and deployment status.',
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
        const result = await supabaseGet<Record<string, unknown>>(`/projects/${ref}/functions`);
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

  // ── Get Function ──────────────────────────────────────────────────

  server.registerTool(
    'supabase_get_function',
    {
      title: 'Get Supabase Edge Function',
      description:
        'Get details for a specific Edge Function deployed to a Supabase project — name, slug, verify_jwt setting, and deployment info.',
      inputSchema: {
        ref: z.string().describe("Supabase project reference (e.g. 'abcdefghijklmnop')"),
        slug: z.string().describe("Edge Function slug (e.g. 'hello-world')"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ref, slug }: { ref: string; slug: string }) => {
      try {
        const result = await supabaseGet<Record<string, unknown>>(
          `/projects/${ref}/functions/${slug}`,
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

  // ── Create Function ───────────────────────────────────────────────

  server.registerTool(
    'supabase_create_function',
    {
      title: 'Create Supabase Edge Function',
      description:
        'Deploy a new Edge Function to a Supabase project. Provide the function name, slug, and optionally the source code body.',
      inputSchema: {
        ref: z.string().describe("Supabase project reference (e.g. 'abcdefghijklmnop')"),
        name: z.string().describe('Human-readable name for the Edge Function'),
        slug: z.string().describe("URL-safe identifier for the Edge Function (e.g. 'hello-world')"),
        verify_jwt: z
          .boolean()
          .optional()
          .describe('Whether to verify JWT on requests to this function. Defaults to true'),
        body: z.string().optional().describe('Edge Function source code (TypeScript/JavaScript)'),
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
      slug: string;
      verify_jwt?: boolean;
      body?: string;
    }) => {
      try {
        const requestBody: Record<string, unknown> = {
          name: params.name,
          slug: params.slug,
          verify_jwt: params.verify_jwt !== undefined ? params.verify_jwt : true,
        };
        if (params.body !== undefined) requestBody.body = params.body;

        const result = await supabasePost<Record<string, unknown>>(
          `/projects/${params.ref}/functions`,
          requestBody,
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

  // ── Update Function ───────────────────────────────────────────────

  server.registerTool(
    'supabase_update_function',
    {
      title: 'Update Supabase Edge Function',
      description:
        'Update an existing Edge Function on a Supabase project. Can update the name, JWT verification setting, or source code.',
      inputSchema: {
        ref: z.string().describe("Supabase project reference (e.g. 'abcdefghijklmnop')"),
        slug: z.string().describe("Edge Function slug to update (e.g. 'hello-world')"),
        name: z.string().optional().describe('New human-readable name for the Edge Function'),
        verify_jwt: z
          .boolean()
          .optional()
          .describe('Whether to verify JWT on requests to this function'),
        body: z
          .string()
          .optional()
          .describe('Updated Edge Function source code (TypeScript/JavaScript)'),
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
      slug: string;
      name?: string;
      verify_jwt?: boolean;
      body?: string;
    }) => {
      try {
        const requestBody: Record<string, unknown> = {};
        if (params.name !== undefined) requestBody.name = params.name;
        if (params.verify_jwt !== undefined) requestBody.verify_jwt = params.verify_jwt;
        if (params.body !== undefined) requestBody.body = params.body;

        const result = await supabasePatch<Record<string, unknown>>(
          `/projects/${params.ref}/functions/${params.slug}`,
          requestBody,
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

  // ── Delete Function ───────────────────────────────────────────────

  server.registerTool(
    'supabase_delete_function',
    {
      title: 'Delete Supabase Edge Function',
      description:
        'WARNING: Permanently deletes an Edge Function from a Supabase project. This action is irreversible.',
      inputSchema: {
        ref: z.string().describe("Supabase project reference (e.g. 'abcdefghijklmnop')"),
        slug: z.string().describe("Edge Function slug to delete (e.g. 'hello-world')"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ref, slug }: { ref: string; slug: string }) => {
      try {
        const result = await supabaseDelete<Record<string, unknown>>(
          `/projects/${ref}/functions/${slug}`,
        );
        return {
          content: [
            {
              type: 'text',
              text: `Function '${slug}' deleted from project ${ref}.\n${JSON.stringify(result, null, 2)}`,
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
