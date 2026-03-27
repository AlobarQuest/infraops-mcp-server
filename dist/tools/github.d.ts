/**
 * GitHub tools — repo creation and deploy key management.
 *
 * These tools complement Coolify's private key tools to enable
 * fully automated private repo deployments:
 *   1. coolify_create_private_key → generates key, stores in Coolify
 *   2. github_add_deploy_key → adds public key to GitHub repo
 *   3. coolify_create_application_deploykey → creates app linked to key
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerGithubTools(server: McpServer): void;
//# sourceMappingURL=github.d.ts.map