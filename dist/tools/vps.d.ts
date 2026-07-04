/**
 * VPS operations tools — shell, health, file, and Docker operations on a chosen VPS.
 *
 * Every tool accepts an `instance` parameter:
 *   - "prod" (default) → Hetzner VPS via SSH (existing path, unchanged).
 *   - "dev"            → OrbStack `ubuntu` machine via `orb run` (no user SSH setup required).
 *
 * Callers already use `coolify_*({instance: "dev"})` to query the dev Coolify; these tools
 * must mirror that routing so follow-up VPS introspection lands on the same host. Leaving
 * instance unspecified preserves existing prod behavior for every pre-existing caller.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function registerVPSTools(server: McpServer): void;
//# sourceMappingURL=vps.d.ts.map