/**
 * Cloudflare security tools — SSL, WAF rulesets, and cache purge.
 *
 * Uses the Rulesets API (not the deprecated Firewall Rules API).
 * Covers: SSL settings, ruleset listing/inspection, ruleset rule CRUD, and cache purge.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  cloudflareGet,
  cloudflarePost,
  cloudflarePatch,
  cloudflarePut,
  handleCloudflareError,
} from "../services/cloudflare-client.js";

export function registerCloudflareSecurityTools(server: McpServer): void {
  // ── Get SSL Setting ───────────────────────────────────────────────

  server.registerTool(
    "cloudflare_get_ssl_setting",
    {
      title: "Get Cloudflare SSL Setting",
      description:
        "Get the SSL/TLS encryption mode for a Cloudflare zone. Returns the current SSL value: off, flexible, full, or strict.",
      inputSchema: {
        zone_id: z.string().describe("Cloudflare zone ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ zone_id }: { zone_id: string }) => {
      try {
        const result = await cloudflareGet<Record<string, unknown>>(
          `/zones/${zone_id}/settings/ssl`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Update SSL Setting ────────────────────────────────────────────

  server.registerTool(
    "cloudflare_update_ssl_setting",
    {
      title: "Update Cloudflare SSL Setting",
      description:
        "Update the SSL/TLS encryption mode for a Cloudflare zone. Choose 'off' (no SSL), 'flexible' (HTTPS to visitors, HTTP to origin), 'full' (HTTPS to origin, no cert validation), or 'strict' (HTTPS to origin with valid cert).",
      inputSchema: {
        zone_id: z.string().describe("Cloudflare zone ID"),
        value: z
          .enum(["off", "flexible", "full", "strict"])
          .describe(
            "SSL encryption mode: off, flexible, full, or strict. 'strict' is recommended for production."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ zone_id, value }: { zone_id: string; value: string }) => {
      try {
        const result = await cloudflarePatch<Record<string, unknown>>(
          `/zones/${zone_id}/settings/ssl`,
          { value }
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── List Rulesets ─────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_list_rulesets",
    {
      title: "List Cloudflare Rulesets",
      description:
        "List all rulesets for a Cloudflare zone using the Rulesets API. Returns ruleset IDs, names, phases, and descriptions. Use this to find the ruleset ID needed for WAF rule management.",
      inputSchema: {
        zone_id: z.string().describe("Cloudflare zone ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ zone_id }: { zone_id: string }) => {
      try {
        const result = await cloudflareGet<Record<string, unknown>>(
          `/zones/${zone_id}/rulesets`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Get Ruleset ───────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_get_ruleset",
    {
      title: "Get Cloudflare Ruleset",
      description:
        "Get the full details of a specific Cloudflare ruleset by ID, including all rules, expressions, and actions. Use this before modifying rules to get the current state.",
      inputSchema: {
        zone_id: z.string().describe("Cloudflare zone ID"),
        ruleset_id: z.string().describe("Cloudflare ruleset ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ zone_id, ruleset_id }: { zone_id: string; ruleset_id: string }) => {
      try {
        const result = await cloudflareGet<Record<string, unknown>>(
          `/zones/${zone_id}/rulesets/${ruleset_id}`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Create Ruleset Rule ───────────────────────────────────────────

  server.registerTool(
    "cloudflare_create_ruleset_rule",
    {
      title: "Create Cloudflare Ruleset Rule",
      description:
        "Add a new rule to an existing Cloudflare ruleset. Fetches the current ruleset, appends the new rule, and PUTs the full ruleset back. Use Cloudflare filter expression syntax for the expression field (e.g. '(ip.src eq 1.2.3.4)').",
      inputSchema: {
        zone_id: z.string().describe("Cloudflare zone ID"),
        ruleset_id: z.string().describe("Cloudflare ruleset ID to add the rule to"),
        expression: z
          .string()
          .describe(
            "Cloudflare filter expression (e.g. '(ip.src eq 1.2.3.4)' or '(http.request.uri.path contains \"/admin\")')"
          ),
        action: z
          .string()
          .describe("Rule action: 'block', 'challenge', 'js_challenge', 'managed_challenge', 'skip', 'log'"),
        description: z
          .string()
          .optional()
          .describe("Optional human-readable description for the rule"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      zone_id: string;
      ruleset_id: string;
      expression: string;
      action: string;
      description?: string;
    }) => {
      try {
        // Fetch current ruleset
        const current = await cloudflareGet<Record<string, unknown>>(
          `/zones/${params.zone_id}/rulesets/${params.ruleset_id}`
        );
        const currentData = current as { result?: { rules?: unknown[]; description?: string; name?: string; phase?: string } };
        const existingRules: unknown[] = currentData.result?.rules ?? [];

        // Build new rule
        const newRule: Record<string, unknown> = {
          expression: params.expression,
          action: params.action,
        };
        if (params.description !== undefined) newRule.description = params.description;

        // PUT the full ruleset back with the new rule appended
        const result = await cloudflarePut<Record<string, unknown>>(
          `/zones/${params.zone_id}/rulesets/${params.ruleset_id}`,
          {
            rules: [...existingRules, newRule],
          }
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Update Ruleset Rule ───────────────────────────────────────────

  server.registerTool(
    "cloudflare_update_ruleset_rule",
    {
      title: "Update Cloudflare Ruleset Rule",
      description:
        "Update an existing rule in a Cloudflare ruleset. Fetches the ruleset, finds the rule by ID, replaces it with the new expression/action, and PUTs the full ruleset back.",
      inputSchema: {
        zone_id: z.string().describe("Cloudflare zone ID"),
        ruleset_id: z.string().describe("Cloudflare ruleset ID"),
        rule_id: z.string().describe("ID of the rule to update"),
        expression: z
          .string()
          .describe("New Cloudflare filter expression for the rule"),
        action: z
          .string()
          .describe("New action: 'block', 'challenge', 'js_challenge', 'managed_challenge', 'skip', 'log'"),
        description: z
          .string()
          .optional()
          .describe("Optional human-readable description for the rule"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      zone_id: string;
      ruleset_id: string;
      rule_id: string;
      expression: string;
      action: string;
      description?: string;
    }) => {
      try {
        // Fetch current ruleset
        const current = await cloudflareGet<Record<string, unknown>>(
          `/zones/${params.zone_id}/rulesets/${params.ruleset_id}`
        );
        const currentData = current as { result?: { rules?: Record<string, unknown>[] } };
        const existingRules: Record<string, unknown>[] = currentData.result?.rules ?? [];

        // Find and replace the target rule
        const updatedRules = existingRules.map((rule) => {
          if (rule.id === params.rule_id) {
            const updated: Record<string, unknown> = {
              ...rule,
              expression: params.expression,
              action: params.action,
            };
            if (params.description !== undefined) updated.description = params.description;
            return updated;
          }
          return rule;
        });

        const result = await cloudflarePut<Record<string, unknown>>(
          `/zones/${params.zone_id}/rulesets/${params.ruleset_id}`,
          { rules: updatedRules }
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Delete Ruleset Rule ───────────────────────────────────────────

  server.registerTool(
    "cloudflare_delete_ruleset_rule",
    {
      title: "Delete Cloudflare Ruleset Rule",
      description:
        "Permanently remove a rule from a Cloudflare ruleset. Fetches the ruleset, filters out the rule by ID, and PUTs the updated ruleset back. WARNING: This is irreversible.",
      inputSchema: {
        zone_id: z.string().describe("Cloudflare zone ID"),
        ruleset_id: z.string().describe("Cloudflare ruleset ID"),
        rule_id: z.string().describe("ID of the rule to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      zone_id,
      ruleset_id,
      rule_id,
    }: {
      zone_id: string;
      ruleset_id: string;
      rule_id: string;
    }) => {
      try {
        // Fetch current ruleset
        const current = await cloudflareGet<Record<string, unknown>>(
          `/zones/${zone_id}/rulesets/${ruleset_id}`
        );
        const currentData = current as { result?: { rules?: Record<string, unknown>[] } };
        const existingRules: Record<string, unknown>[] = currentData.result?.rules ?? [];

        // Filter out the deleted rule
        const updatedRules = existingRules.filter((rule) => rule.id !== rule_id);

        const result = await cloudflarePut<Record<string, unknown>>(
          `/zones/${zone_id}/rulesets/${ruleset_id}`,
          { rules: updatedRules }
        );
        return {
          content: [
            {
              type: "text",
              text: `Rule ${rule_id} deleted.\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );

  // ── Purge Cache ───────────────────────────────────────────────────

  server.registerTool(
    "cloudflare_purge_cache",
    {
      title: "Purge Cloudflare Cache",
      description:
        "Purge cached content from Cloudflare's edge for a zone. Can purge everything, specific URLs, or by cache tags. At least one of purge_everything, files, or tags must be provided. NOTE: purge_everything invalidates all cached content — use with caution.",
      inputSchema: {
        zone_id: z.string().describe("Cloudflare zone ID"),
        purge_everything: z
          .boolean()
          .optional()
          .describe("If true, purges all cached content for the zone. Use with caution."),
        files: z
          .array(z.string())
          .optional()
          .describe("Array of URLs to purge from cache (e.g. ['https://example.com/image.png'])"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Array of cache tags to purge (requires Cloudflare Enterprise)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      zone_id: string;
      purge_everything?: boolean;
      files?: string[];
      tags?: string[];
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.purge_everything !== undefined) body.purge_everything = params.purge_everything;
        if (params.files !== undefined && params.files.length > 0) body.files = params.files;
        if (params.tags !== undefined && params.tags.length > 0) body.tags = params.tags;

        const result = await cloudflarePost<Record<string, unknown>>(
          `/zones/${params.zone_id}/purge_cache`,
          body
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCloudflareError(error) }],
        };
      }
    }
  );
}
