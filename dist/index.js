#!/usr/bin/env node
/**
 * InfraOps MCP Server
 *
 * A Model Context Protocol server for infrastructure operations.
 * Currently supports Coolify management, with future extensibility
 * for VPS (SSH), Namecheap (DNS), and Cloudflare (tunnels/DNS).
 *
 * Environment variables:
 *   COOLIFY_BASE_URL   - Your Coolify instance URL (e.g. https://coolify.devonwatkins.com)
 *   COOLIFY_API_TOKEN  - Bearer token from Coolify UI → Settings → API Tokens
 *   TRANSPORT          - "stdio" (default) or "http"
 *   PORT               - HTTP port when TRANSPORT=http (default: 3000)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// Tool registrars — one per domain
import { registerProjectTools } from "./tools/projects.js";
import { registerApplicationTools } from "./tools/applications.js";
import { registerDeploymentTools } from "./tools/deployments.js";
import { registerEnvVarTools } from "./tools/env-vars.js";
import { registerDatabaseTools } from "./tools/databases.js";
import { registerServerTools } from "./tools/servers.js";
import { registerServiceTools } from "./tools/services.js";
import { registerControlTools } from "./tools/control.js";
// ── Create server ────────────────────────────────────────────────────
const server = new McpServer({
    name: "infraops-mcp-server",
    version: "1.0.0",
});
// ── Register all Coolify tools ───────────────────────────────────────
registerProjectTools(server);
registerApplicationTools(server);
registerDeploymentTools(server);
registerEnvVarTools(server);
registerDatabaseTools(server);
registerServerTools(server);
registerServiceTools(server);
registerControlTools(server);
// ── Transport ────────────────────────────────────────────────────────
async function runStdio() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("InfraOps MCP server running via stdio");
    console.error(`Coolify target: ${process.env.COOLIFY_BASE_URL ?? "(not set)"}`);
}
// Main
const transportMode = process.env.TRANSPORT || "stdio";
if (transportMode === "stdio") {
    runStdio().catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}
else {
    console.error(`Unknown transport: ${transportMode}. Supported: stdio. HTTP transport can be added later.`);
    process.exit(1);
}
//# sourceMappingURL=index.js.map