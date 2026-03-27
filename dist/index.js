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
 *   - Cloudflare: DNS, Pages, Workers, R2, Tunnels, Security (WAF/rate limiting)
 *   - Supabase: Project management, database, edge functions, configuration
 *
 * Environment variables:
 *   COOLIFY_PROD_BASE_URL       - Production Coolify instance URL (or legacy COOLIFY_BASE_URL)
 *   COOLIFY_PROD_API_TOKEN      - Production Coolify Bearer token (or legacy COOLIFY_API_TOKEN)
 *   COOLIFY_DEV_BASE_URL        - Dev Coolify instance URL (optional)
 *   COOLIFY_DEV_API_TOKEN       - Dev Coolify Bearer token (optional)
 *   HETZNER_API_TOKEN           - Hetzner Cloud API token (optional, from BWS via start.sh)
 *   VPS_HOST                    - VPS IP address (default: 178.156.247.239)
 *   VPS_USER                    - SSH user (default: root)
 *   VPS_SSH_KEY_PATH            - SSH private key path (default: ~/.ssh/hetzner_ed25519)
 *   VPS_SSH_PASSPHRASE          - SSH key passphrase (optional, from BWS via start.sh)
 *   NAMECHEAP_API_USER          - Namecheap API username (optional, from BWS via start.sh)
 *   NAMECHEAP_API_KEY           - Namecheap API key (optional, from BWS via start.sh)
 *   NAMECHEAP_PROXY_TOKEN       - Bearer token for namecheap-proxy (from BWS via start.sh)
 *   NAMECHEAP_USE_SANDBOX       - "true" for sandbox, "false" for production (default: "true")
 *   CLOUDFLARE_API_TOKEN        - Cloudflare API token (optional, from BWS via start.sh)
 *   CLOUDFLARE_ACCOUNT_ID       - Cloudflare account ID (optional, from BWS via start.sh)
 *   SUPABASE_ACCESS_TOKEN       - Supabase management API token (optional, from BWS via start.sh)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// Coolify client
import { getConfiguredInstances, getCoolifyInstanceUrl, isCoolifyInstanceConfigured } from "./services/coolify-client.js";
// Coolify tools
import { registerProjectTools } from "./tools/projects.js";
import { registerApplicationTools } from "./tools/applications.js";
import { registerPrivateKeyTools } from "./tools/private-keys.js";
import { registerDeploymentTools } from "./tools/deployments.js";
import { registerEnvVarTools } from "./tools/env-vars.js";
import { registerDatabaseTools } from "./tools/databases.js";
import { registerServerTools } from "./tools/servers.js";
import { registerServiceTools } from "./tools/services.js";
import { registerControlTools } from "./tools/control.js";
// GitHub tools
import { registerGithubTools } from "./tools/github.js";
import { isGithubConfigured } from "./services/github-client.js";
// Hetzner Cloud tools
import { registerHetznerServerTools } from "./tools/hetzner-servers.js";
import { registerHetznerNetworkingTools } from "./tools/hetzner-networking.js";
import { isHetznerConfigured } from "./services/hetzner-client.js";
// VPS SSH tools
import { registerVPSTools } from "./tools/vps.js";
// Namecheap tools
import { registerNamecheapDNSTools } from "./tools/namecheap-dns.js";
import { registerNamecheapDomainTools } from "./tools/namecheap-domains.js";
import { isNamecheapConfigured, getNamecheapEnvironment } from "./services/namecheap-client.js";
// Cloudflare tools
import { registerCloudflareDNSTools } from "./tools/cloudflare-dns.js";
import { registerCloudflarePagesTools } from "./tools/cloudflare-pages.js";
import { registerCloudflareWorkersTools } from "./tools/cloudflare-workers.js";
import { registerCloudflareR2Tools } from "./tools/cloudflare-r2.js";
import { registerCloudflareTunnelTools } from "./tools/cloudflare-tunnels.js";
import { registerCloudflareSecurityTools } from "./tools/cloudflare-security.js";
import { isCloudflareConfigured } from "./services/cloudflare-client.js";
// Supabase tools
import { registerSupabaseProjectTools } from "./tools/supabase-projects.js";
import { registerSupabaseDatabaseTools } from "./tools/supabase-database.js";
import { registerSupabaseFunctionTools } from "./tools/supabase-functions.js";
import { registerSupabaseConfigTools } from "./tools/supabase-config.js";
import { isSupabaseConfigured } from "./services/supabase-client.js";
// ── Create server ────────────────────────────────────────────────────
const server = new McpServer({
    name: "infraops-mcp-server",
    version: "3.2.0",
});
// ── Register Coolify tools ───────────────────────────────────────────
// Tools are always registered — instance selection happens at call time via the `instance` parameter.
// At least one instance (prod) must be configured.
const coolifyInstances = getConfiguredInstances();
if (coolifyInstances.length === 0) {
    console.error("WARNING: No Coolify instances configured. Set COOLIFY_PROD_BASE_URL/TOKEN (or COOLIFY_BASE_URL/TOKEN).");
}
registerProjectTools(server);
registerApplicationTools(server);
registerPrivateKeyTools(server);
registerDeploymentTools(server);
registerEnvVarTools(server);
registerDatabaseTools(server);
registerServerTools(server);
registerServiceTools(server);
registerControlTools(server);
// ── Register GitHub tools ──────────────────────────────────────────
if (isGithubConfigured()) {
    registerGithubTools(server);
    console.error("GitHub tools registered");
}
else {
    console.error("GITHUB_TOKEN not set — GitHub tools disabled");
}
// ── Register Hetzner Cloud tools ─────────────────────────────────────
if (isHetznerConfigured()) {
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
    console.error("NAMECHEAP_API_USER/KEY/PROXY_TOKEN not set — Namecheap tools disabled");
}
// ── Register Cloudflare tools ──────────────────────────────────────
if (isCloudflareConfigured()) {
    registerCloudflareDNSTools(server);
    registerCloudflarePagesTools(server);
    registerCloudflareWorkersTools(server);
    registerCloudflareR2Tools(server);
    registerCloudflareTunnelTools(server);
    registerCloudflareSecurityTools(server);
    console.error("Cloudflare tools registered");
}
else {
    console.error("CLOUDFLARE_API_TOKEN/ACCOUNT_ID not set — Cloudflare tools disabled");
}
// ── Register Supabase tools ────────────────────────────────────────
if (isSupabaseConfigured()) {
    registerSupabaseProjectTools(server);
    registerSupabaseDatabaseTools(server);
    registerSupabaseFunctionTools(server);
    registerSupabaseConfigTools(server);
    console.error("Supabase tools registered");
}
else {
    console.error("SUPABASE_ACCESS_TOKEN not set — Supabase tools disabled");
}
// ── Transport ────────────────────────────────────────────────────────
async function runStdio() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("InfraOps MCP server v3.2.0 running via stdio");
    console.error(`  Coolify prod: ${isCoolifyInstanceConfigured("prod") ? getCoolifyInstanceUrl("prod") : "not configured"}`);
    console.error(`  Coolify dev:  ${isCoolifyInstanceConfigured("dev") ? getCoolifyInstanceUrl("dev") : "not configured"}`);
    console.error(`  Hetzner: ${isHetznerConfigured() ? "configured" : "not configured"}`);
    console.error(`  VPS SSH: ${process.env.VPS_HOST || "178.156.247.239"}`);
    console.error(`  Namecheap: ${isNamecheapConfigured() ? getNamecheapEnvironment() : "not configured"}`);
    console.error(`  Cloudflare: ${isCloudflareConfigured() ? "configured" : "not configured"}`);
    console.error(`  Supabase: ${isSupabaseConfigured() ? "configured" : "not configured"}`);
    console.error(`  GitHub: ${isGithubConfigured() ? "configured" : "not configured"}`);
}
runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map