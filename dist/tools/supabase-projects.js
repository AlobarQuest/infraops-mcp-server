/**
 * Supabase project lifecycle management tools.
 *
 * Covers project and organization operations:
 * list projects, get project, create project, delete project,
 * pause project, restore project, list organizations,
 * get API keys, and get project health.
 */
import { z } from 'zod';
import { supabaseGet, supabasePost, supabaseDelete, handleSupabaseError, } from '../services/supabase-client.js';
export function registerSupabaseProjectTools(server) {
    // ── List Projects ─────────────────────────────────────────────────
    server.registerTool('supabase_list_projects', {
        title: 'List Supabase Projects',
        description: 'List all Supabase projects in the account. Returns project references, names, regions, and status.',
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async () => {
        try {
            const result = await supabaseGet('/projects');
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
    // ── Get Project ───────────────────────────────────────────────────
    server.registerTool('supabase_get_project', {
        title: 'Get Supabase Project',
        description: 'Get full details for a Supabase project by reference — name, region, status, and configuration.',
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
            const result = await supabaseGet(`/projects/${ref}`);
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
    // ── Create Project ────────────────────────────────────────────────
    server.registerTool('supabase_create_project', {
        title: 'Create Supabase Project',
        description: 'Create a new Supabase project under an organization. Returns the created project with its reference ID.',
        inputSchema: {
            name: z.string().describe('Name of the new project'),
            organization_id: z.string().describe('Organization ID to create the project under'),
            db_pass: z
                .string()
                .min(6)
                .describe('Database password for the project (minimum 6 characters)'),
            region: z
                .string()
                .describe("Region to deploy the project in (e.g. 'us-east-1', 'eu-west-1')"),
            plan: z
                .enum(['free', 'pro'])
                .optional()
                .describe("Billing plan for the project. Defaults to 'free'"),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const body = {
                name: params.name,
                organization_id: params.organization_id,
                db_pass: params.db_pass,
                region: params.region,
            };
            if (params.plan !== undefined)
                body.plan = params.plan;
            const result = await supabasePost('/projects', body);
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
    // ── Delete Project ────────────────────────────────────────────────
    server.registerTool('supabase_delete_project', {
        title: 'Delete Supabase Project',
        description: 'WARNING: This permanently deletes the project, its database, and all associated resources. This action is irreversible.',
        inputSchema: {
            ref: z.string().describe('Supabase project reference to delete'),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ ref }) => {
        try {
            const result = await supabaseDelete(`/projects/${ref}`);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Project ${ref} deleted.\n${JSON.stringify(result, null, 2)}`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: 'text', text: handleSupabaseError(error) }],
            };
        }
    });
    // ── Pause Project ─────────────────────────────────────────────────
    server.registerTool('supabase_pause_project', {
        title: 'Pause Supabase Project',
        description: 'Pause a Supabase project to stop resource usage. The project can be restored later.',
        inputSchema: {
            ref: z.string().describe('Supabase project reference to pause'),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ ref }) => {
        try {
            const result = await supabasePost(`/projects/${ref}/pause`, {});
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
    // ── Restore Project ───────────────────────────────────────────────
    server.registerTool('supabase_restore_project', {
        title: 'Restore Supabase Project',
        description: 'Restore a previously paused Supabase project. The project will resume normal operation.',
        inputSchema: {
            ref: z.string().describe('Supabase project reference to restore'),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ ref }) => {
        try {
            const result = await supabasePost(`/projects/${ref}/restore`, {});
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
    // ── List Organizations ────────────────────────────────────────────
    server.registerTool('supabase_list_organizations', {
        title: 'List Supabase Organizations',
        description: 'List all organizations in the Supabase account. Returns organization IDs and names.',
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async () => {
        try {
            const result = await supabaseGet('/organizations');
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
    // ── Get API Keys ──────────────────────────────────────────────────
    server.registerTool('supabase_get_api_keys', {
        title: 'Get Supabase API Keys',
        description: 'Get the API keys for a Supabase project — anon key, service role key, and JWT secret.',
        inputSchema: {
            ref: z.string().describe('Supabase project reference'),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ ref }) => {
        try {
            const result = await supabaseGet(`/projects/${ref}/api-keys`);
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
    // ── Get Project Health ────────────────────────────────────────────
    server.registerTool('supabase_get_project_health', {
        title: 'Get Supabase Project Health',
        description: 'Get the health status of all services for a Supabase project — database, auth, storage, and edge functions.',
        inputSchema: {
            ref: z.string().describe('Supabase project reference'),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ ref }) => {
        try {
            const result = await supabaseGet(`/projects/${ref}/health`);
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
//# sourceMappingURL=supabase-projects.js.map