/**
 * Shared response helpers for Coolify tools.
 *
 * Centralizes the `{ content: [{ type: "text", text }] }` shape and enforces
 * the `CHARACTER_LIMIT` budget that was previously declared but never applied —
 * large list/overview payloads used to be stringified in full and flood the
 * LLM context. New tools and the retrofitted read tools return via `jsonResponse`.
 */
export interface ToolTextResponse {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: boolean;
    [key: string]: unknown;
}
/**
 * Build a JSON tool response, truncating with an explicit marker if it exceeds
 * `charLimit` (default `CHARACTER_LIMIT`). The marker tells the caller how to
 * narrow the result rather than silently dropping data.
 */
export declare function jsonResponse(data: unknown, opts?: {
    charLimit?: number;
}): ToolTextResponse;
export interface TruncatedLogs {
    logs: string;
    total_lines: number;
    showing_start: number;
    showing_end: number;
}
/**
 * Tail-truncate a log blob. Page 1 = newest `lineLimit` lines; higher pages walk
 * older. Mirrors coolify-mcp's truncateLogs semantics (lineLimit 200, charLimit 50K).
 */
export declare function truncateLogs(logs: string, lineLimit?: number, charLimit?: number, page?: number): TruncatedLogs;
//# sourceMappingURL=response.d.ts.map