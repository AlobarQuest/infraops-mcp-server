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
/** Truncate text to `charLimit` with an explicit narrowing marker. */
export declare function truncateToLimit(text: string, charLimit?: number): string;
/**
 * Build a JSON tool response. Serialize-only — truncation is applied centrally by
 * the redaction wrapper (register-sanitized.ts) AFTER redaction, so a secret can
 * never be split across the truncation boundary.
 */
export declare function jsonResponse(data: unknown, _opts?: {
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