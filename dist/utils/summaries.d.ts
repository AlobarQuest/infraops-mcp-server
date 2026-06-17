/**
 * Summary projections for Coolify list/overview responses.
 *
 * Coolify list endpoints return ~60-95 fields per row; the full payload blows the
 * LLM context budget on instances with many resources. These projectors keep the
 * handful of fields an agent actually needs to triage and drill in. List tools
 * default to `summary: true`; pass `summary: false` for the full objects.
 */
export declare const toApplicationSummary: (a: Record<string, any>) => Record<string, unknown>;
export declare const toDatabaseSummary: (d: Record<string, any>) => Record<string, unknown>;
export declare const toServiceSummary: (s: Record<string, any>) => Record<string, unknown>;
export declare const toServerSummary: (s: Record<string, any>) => Record<string, unknown>;
export declare const toProjectSummary: (p: Record<string, any>) => Record<string, unknown>;
export declare const toGitHubAppSummary: (g: Record<string, any>) => Record<string, unknown>;
/** Apply a projector to an array iff `summary` is truthy; otherwise pass through. */
export declare function summarize<T extends Record<string, any>>(items: T[], projector: (x: Record<string, any>) => Record<string, unknown>, summary: boolean): unknown[];
//# sourceMappingURL=summaries.d.ts.map