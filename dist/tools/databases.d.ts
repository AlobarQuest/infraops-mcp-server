/**
 * Database management tools for Coolify.
 *
 * Per Devon's standards:
 * - Flavor A: SQLite (no Coolify DB resource needed)
 * - Flavor B/C: PostgreSQL 16 as a separate Coolify database resource
 * - Redis only in Flavor C (part of docker-compose, not a standalone DB resource)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerDatabaseTools(server: McpServer): void;
//# sourceMappingURL=databases.d.ts.map