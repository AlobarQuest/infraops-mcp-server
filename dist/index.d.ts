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
 *   NAMECHEAP_PROXY_TOKEN       - Bearer token for namecheap-proxy (from BWS via start.sh)
 *   NAMECHEAP_USE_SANDBOX       - "true" for sandbox, "false" for production (default: "true")
 */
export {};
//# sourceMappingURL=index.d.ts.map