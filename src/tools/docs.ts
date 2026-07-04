/**
 * Coolify documentation search tool.
 *
 * Full-text (BM25) search over the official Coolify docs. Instance-agnostic — the
 * docs are global, so this tool takes no `instance` parameter.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchDocs } from '../services/docs-search.js';
import { jsonResponse } from '../utils/response.js';

export function registerDocsTools(server: McpServer): void {
  server.registerTool(
    'coolify_search_docs',
    {
      title: 'Search Coolify Documentation',
      description:
        'Search the official Coolify documentation and return the most relevant sections ' +
        '(title, url, description, snippet). Use for API/config/feature questions. No instance needed.',
      inputSchema: {
        query: z.string().min(1).describe("Search query, e.g. 'docker compose healthcheck'"),
        limit: z.number().int().min(1).max(20).default(5).describe('Max results (default 5)'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit }: { query: string; limit: number }) => {
      try {
        const results = await searchDocs(query, limit);
        return jsonResponse({ query, count: results.length, results });
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error: Failed to search Coolify docs — ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    },
  );
}
