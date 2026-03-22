/**
 * Supabase Edge Functions management tools.
 *
 * Covers Edge Function CRUD operations:
 * list functions, get function, create function,
 * update function, and delete function.
 *
 * Note: The Supabase Edge Functions API may require multipart form upload
 * for the function body in some versions. This implementation uses JSON body —
 * adjust to multipart if needed at runtime.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerSupabaseFunctionTools(server: McpServer): void;
//# sourceMappingURL=supabase-functions.d.ts.map