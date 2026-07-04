/**
 * GitHub-App tools for Coolify.
 *
 * Manages Coolify's own GitHub-App source resource (`/github-apps`) — distinct from
 * the `github_*` provider tools, which talk to GitHub's API for deploy keys. Use these
 * to register/inspect a GitHub App that Coolify uses as a deployment source, and to
 * browse the repos/branches it can see.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerGithubAppTools(server: McpServer): void;
//# sourceMappingURL=github-apps.d.ts.map