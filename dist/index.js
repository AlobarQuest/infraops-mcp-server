#!/usr/bin/env node
/**
 * InfraOps MCP Server
 *
 * A Model Context Protocol server for infrastructure operations.
 *
 * Providers:
 *   - Coolify: Full Coolify management (projects, apps, databases, services, deployments)
 *   - Hetzner Cloud: Server lifecycle, firewalls, SSH keys, volumes, snapshots, networks
 *   - VPS (SSH): Direct shell access, health monitoring, file ops, Docker inspection
 *   - Namecheap: Domain lifecycle + DNS record management (sandbox/production)
 *
 * Environment variables:
 *   COOLIFY_BASE_URL            - Coolify instance URL
 *   COOLIFY_API_TOKEN           - Coolify Bearer token (from BWS via start.sh)
 *   HETZNER_API_TOKEN           - Hetzner Cloud API token (optional, from BWS via start.sh)
 *   VPS_HOST                    - VPS IP address (default: 178.156.247.239)
 *   VPS_USER                    - SSH user (default: root)
 *   VPS_SSH_KEY_PATH            - SSH private key path (default: ~/.ssh/hetzner_ed25519)
 *   VPS_SSH_PASSPHRASE          - SSH key passphrase (optional, from BWS via start.sh)
 *   NAMECHEAP_API_USER          - Namecheap API username (optional, from BWS via start.sh)
 *   NAMECHEAP_API_KEY           - Namecheap API key (optional, from BWS via start.sh)
 *   NAMECHEAP_CLIENT_IP         - Your machine's public IP (must be whitelisted in Namecheap)
 *   NAMECHEAP_USE_SANDBOX       - "true" for sandbox, "false" for production (default: "true")
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// Coolify tools
import { registerProjectTools } from "./tools/projects.js";
import { registerApplicationTools } from "./tools/applications.js";
import { registerDeploymentTools } from "./tools/deployments.js";
import { registerEnvVarTools } from "./tools/env-vars.js";
import { registerDatabaseTools } from "./tools/databases.js";
import { registerServerTools } from "./tools/servers.js";
import { registerServiceTools } from "./tools/services.js";
import { registerControlTools } from "./tools/control.js";
// Hetzner Cloud tools
import { registerHetznerServerTools } from "./tools/hetzner-servers.js";
import { registerHetznerNetworkingTools } from "./tools/hetzner-networking.js";
// VPS SSH tools
import { registerVPSTools } from "./tools/vps.js";
// Namecheap tools
import { registerNamecheapDNSTools } from "./tools/namecheap-dns.js";
import { registerNamecheapDomainTools } from "./tools/namecheap-domains.js";
import { isNamecheapConfigured, getNamecheapEnvironment } from "./services/namecheap-client.js";
// ── Create server ────────────────────────────────────────────────────
const server = new McpServer({
    name: "infraops-mcp-server",
    version: "2.0.0",
});
// ── Register Coolify tools ───────────────────────────────────────────
registerProjectTools(server);
registerApplicationTools(server);
registerDeploymentTools(server);
registerEnvVarTools(server);
registerDatabaseTools(server);
registerServerTools(server);
registerServiceTools(server);
registerControlTools(server);
// ── Register Hetzner Cloud tools ─────────────────────────────────────
if (process.env.HETZNER_API_TOKEN) {
    registerHetznerServerTools(server);
    registerHetznerNetworkingTools(server);
    console.error("Hetzner Cloud tools registered");
}
else {
    console.error("HETZNER_API_TOKEN not set — Hetzner Cloud tools disabled");
}
// ── Register VPS SSH tools ───────────────────────────────────────────
registerVPSTools(server);
console.error(`VPS SSH tools registered (host: ${process.env.VPS_HOST || "178.156.247.239"})`);
// ── Register Namecheap tools ────────────────────────────────────────
if (isNamecheapConfigured()) {
    registerNamecheapDomainTools(server);
    registerNamecheapDNSTools(server);
    console.error(`Namecheap tools registered (env: ${getNamecheapEnvironment()})`);
}
else {
    console.error("NAMECHEAP_API_USER/KEY/IP not set — Namecheap tools disabled");
}
// ── Transport ────────────────────────────────────────────────────────
async function runStdio() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("InfraOps MCP server v2.0.0 running via stdio");
    console.error(`  Coolify: ${process.env.COOLIFY_BASE_URL ?? "(not set)"}`);
    console.error(`  Hetzner: ${process.env.HETZNER_API_TOKEN ? "configured" : "not configured"}`);
    console.error(`  VPS SSH: ${process.env.VPS_HOST || "178.156.247.239"}`);
    console.error(`  Namecheap: ${isNamecheapConfigured() ? getNamecheapEnvironment() : "not configured"}`);
}
runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map