/**
 * Supabase database tools.
 *
 * Covers SQL execution and Postgres configuration:
 * run SQL query, list extensions, get Postgres config,
 * and update Postgres config.
 */
import { z } from 'zod';
import { supabaseGet, supabasePost, supabasePut, handleSupabaseError, } from '../services/supabase-client.js';
export function registerSupabaseDatabaseTools(server) {
    // ── Run SQL ───────────────────────────────────────────────────────
    server.registerTool('supabase_run_sql', {
        title: 'Run SQL on Supabase Project',
        description: "Execute arbitrary SQL against a project's database. WARNING: This can modify or destroy data. Use with caution.",
        inputSchema: {
            ref: z.string().describe("Supabase project reference (e.g. 'abcdefghijklmnop')"),
            query: z.string().describe('SQL query to execute against the project database'),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ ref, query }) => {
        try {
            const result = await supabasePost(`/projects/${ref}/database/query`, { query });
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: 'text', text: handleSupabaseError(error) }],
            };
        }
    });
    // ── List Extensions ───────────────────────────────────────────────
    server.registerTool('supabase_list_extensions', {
        title: 'List Supabase Database Extensions',
        description: 'List all Postgres extensions available and their enabled status for a Supabase project database.',
        inputSchema: {
            ref: z.string().describe("Supabase project reference (e.g. 'abcdefghijklmnop')"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ ref }) => {
        try {
            const result = await supabaseGet(`/projects/${ref}/database/extensions`);
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: 'text', text: handleSupabaseError(error) }],
            };
        }
    });
    // ── Get Postgres Config ───────────────────────────────────────────
    server.registerTool('supabase_get_postgres_config', {
        title: 'Get Supabase Postgres Config',
        description: 'Get the current Postgres configuration for a Supabase project, including settings like max_connections and statement_timeout.',
        inputSchema: {
            ref: z.string().describe("Supabase project reference (e.g. 'abcdefghijklmnop')"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ ref }) => {
        try {
            const result = await supabaseGet(`/projects/${ref}/config/database/postgres`);
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: 'text', text: handleSupabaseError(error) }],
            };
        }
    });
    // ── Update Postgres Config ────────────────────────────────────────
    server.registerTool('supabase_update_postgres_config', {
        title: 'Update Supabase Postgres Config',
        description: 'Update Postgres configuration settings for a Supabase project. Accepts key-value pairs for settings such as max_connections and statement_timeout.',
        inputSchema: {
            ref: z.string().describe("Supabase project reference (e.g. 'abcdefghijklmnop')"),
            config: z
                .record(z.string())
                .describe("Postgres configuration key-value pairs to update (e.g. { max_connections: '100', statement_timeout: '30000' })"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ ref, config }) => {
        try {
            const result = await supabasePut(`/projects/${ref}/config/database/postgres`, config);
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: 'text', text: handleSupabaseError(error) }],
            };
        }
    });
}
//# sourceMappingURL=supabase-database.js.map