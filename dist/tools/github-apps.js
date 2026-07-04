/**
 * GitHub-App tools for Coolify.
 *
 * Manages Coolify's own GitHub-App source resource (`/github-apps`) — distinct from
 * the `github_*` provider tools, which talk to GitHub's API for deploy keys. Use these
 * to register/inspect a GitHub App that Coolify uses as a deployment source, and to
 * browse the repos/branches it can see.
 */
import { z } from 'zod';
import { coolifyGet, coolifyPost, coolifyPatch, coolifyDelete, handleCoolifyError, } from '../services/coolify-client.js';
import { CoolifyInstanceSchema, CoolifyInstanceRequiredSchema } from '../schemas/common.js';
import { jsonResponse } from '../utils/response.js';
import { toGitHubAppSummary } from '../utils/summaries.js';
export function registerGithubAppTools(server) {
    // ── List GitHub Apps ─────────────────────────────────────────────
    server.registerTool('coolify_list_github_apps', {
        title: 'List Coolify GitHub Apps',
        description: 'List GitHub-App source integrations configured in Coolify. Returns id, uuid, name, organization. Use coolify_get_github_app for full detail.',
        inputSchema: {
            summary: z
                .boolean()
                .default(true)
                .describe('Return a compact projection (default true); false for full objects'),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ summary, instance }) => {
        try {
            const apps = await coolifyGet('/github-apps', undefined, instance);
            const out = summary && Array.isArray(apps) ? apps.map((a) => toGitHubAppSummary(a)) : apps;
            return jsonResponse(out);
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── Get one GitHub App (filter list client-side by id) ───────────
    server.registerTool('coolify_get_github_app', {
        title: 'Get Coolify GitHub App',
        description: 'Get a single GitHub-App integration by its numeric id.',
        inputSchema: {
            id: z.number().int().describe('GitHub App id'),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ id, instance }) => {
        try {
            const apps = await coolifyGet('/github-apps', undefined, instance);
            const app = Array.isArray(apps) ? apps.find((a) => a.id === id) : undefined;
            if (!app) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `Error: No GitHub App found with id ${id}.` }],
                };
            }
            return jsonResponse(app);
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── Create GitHub App ────────────────────────────────────────────
    server.registerTool('coolify_create_github_app', {
        title: 'Create Coolify GitHub App',
        description: 'Register a GitHub App as a Coolify deployment source.',
        inputSchema: {
            name: z.string().min(1),
            api_url: z.string().min(1).describe('GitHub API URL, e.g. https://api.github.com'),
            html_url: z.string().min(1).describe('GitHub base URL, e.g. https://github.com'),
            app_id: z.number().int(),
            installation_id: z.number().int(),
            client_id: z.string().min(1),
            client_secret: z.string().min(1),
            private_key_uuid: z.string().min(1).describe('UUID of a Coolify private key'),
            organization: z.string().optional(),
            custom_user: z.string().optional(),
            custom_port: z.number().int().optional(),
            webhook_secret: z.string().optional(),
            is_system_wide: z.boolean().optional(),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const { instance, ...body } = params;
            const app = await coolifyPost('/github-apps', body, instance);
            return jsonResponse(app);
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── Update GitHub App ────────────────────────────────────────────
    server.registerTool('coolify_update_github_app', {
        title: 'Update Coolify GitHub App',
        description: 'Update fields of a GitHub-App integration. Only supplied fields change.',
        inputSchema: {
            id: z.number().int().describe('GitHub App id'),
            name: z.string().optional(),
            organization: z.string().optional(),
            api_url: z.string().optional(),
            html_url: z.string().optional(),
            custom_user: z.string().optional(),
            custom_port: z.number().int().optional(),
            app_id: z.number().int().optional(),
            installation_id: z.number().int().optional(),
            client_id: z.string().optional(),
            client_secret: z.string().optional(),
            webhook_secret: z.string().optional(),
            private_key_uuid: z.string().optional(),
            is_system_wide: z.boolean().optional(),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async (params) => {
        try {
            const { id, instance, ...body } = params;
            const result = await coolifyPatch(`/github-apps/${id}`, body, instance);
            return jsonResponse(result);
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── Delete GitHub App ────────────────────────────────────────────
    server.registerTool('coolify_delete_github_app', {
        title: 'Delete Coolify GitHub App',
        description: 'Delete a GitHub-App integration by id.',
        inputSchema: {
            id: z.number().int().describe('GitHub App id'),
            instance: CoolifyInstanceRequiredSchema,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async ({ id, instance }) => {
        try {
            const result = await coolifyDelete(`/github-apps/${id}`, instance);
            return jsonResponse(result);
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── List repositories visible to the App ─────────────────────────
    server.registerTool('coolify_list_github_app_repos', {
        title: 'List GitHub App Repositories',
        description: 'List repositories the GitHub App can access (name, full_name, default_branch, private).',
        inputSchema: {
            id: z.number().int().describe('GitHub App id'),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ id, instance }) => {
        try {
            const result = await coolifyGet(`/github-apps/${id}/repositories`, undefined, instance);
            const repos = Array.isArray(result) ? result : (result?.repositories ?? []);
            return jsonResponse(repos);
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
    // ── List branches for a repo ─────────────────────────────────────
    server.registerTool('coolify_list_github_app_branches', {
        title: 'List GitHub App Repository Branches',
        description: 'List branches for a repo the GitHub App can access.',
        inputSchema: {
            id: z.number().int().describe('GitHub App id'),
            owner: z.string().min(1).describe('Repository owner/org'),
            repo: z.string().min(1).describe('Repository name'),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ id, owner, repo, instance, }) => {
        try {
            const branches = await coolifyGet(`/github-apps/${id}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`, undefined, instance);
            return jsonResponse(branches);
        }
        catch (error) {
            return { isError: true, content: [{ type: 'text', text: handleCoolifyError(error) }] };
        }
    });
}
//# sourceMappingURL=github-apps.js.map