/**
 * Reviewed classification of every tool served by the pinned Porkbun MCP server.
 *
 * infraops starts @porkbunllc/mcp-server as a child process and forwards calls
 * to it. A test lists the installed package's tools and fails if any is missing
 * from DENIED_TOOLS or TOOL_AREAS, so an upgrade cannot add an unreviewed tool.
 *
 * Environment variables:
 *   PORKBUN_TOOL_GROUPS - Comma-separated areas to expose (default: all allowed tools)
 */
export declare const PORKBUN_PACKAGE_VERSION = "0.54.0";
export declare const PORKBUN_AREAS: readonly ["account", "cloudflare", "dns", "docs", "domains", "email", "hosting", "marketplace", "ssl", "webhooks"];
export type PorkbunArea = (typeof PORKBUN_AREAS)[number];
export declare const DENIED_TOOLS: ReadonlySet<string>;
export declare const TOOL_AREAS: Readonly<Record<string, PorkbunArea>>;
/** Parse PORKBUN_TOOL_GROUPS: null (unset or blank) means every allowed tool. */
export declare function parseToolGroups(raw: string | undefined): ReadonlySet<PorkbunArea> | null;
export declare function isExposed(name: string, groups: ReadonlySet<PorkbunArea> | null): boolean;
//# sourceMappingURL=porkbun-catalog.d.ts.map