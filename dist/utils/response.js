/**
 * Shared response helpers for Coolify tools.
 *
 * Centralizes the `{ content: [{ type: "text", text }] }` shape and enforces
 * the `CHARACTER_LIMIT` budget that was previously declared but never applied —
 * large list/overview payloads used to be stringified in full and flood the
 * LLM context. New tools and the retrofitted read tools return via `jsonResponse`.
 */
import { CHARACTER_LIMIT } from "../constants.js";
/**
 * Build a JSON tool response, truncating with an explicit marker if it exceeds
 * `charLimit` (default `CHARACTER_LIMIT`). The marker tells the caller how to
 * narrow the result rather than silently dropping data.
 */
export function jsonResponse(data, opts = {}) {
    const charLimit = opts.charLimit ?? CHARACTER_LIMIT;
    let text = JSON.stringify(data, null, 2);
    if (text.length > charLimit) {
        const keep = Math.max(0, charLimit - 220);
        const kb = Math.round(charLimit / 1000);
        text =
            text.slice(0, keep) +
                `\n…[truncated: response exceeded ${kb}K chars — narrow it with summary:true, ` +
                `pagination (page/per_page), or a more specific UUID/query]…`;
    }
    return { content: [{ type: "text", text }] };
}
/**
 * Tail-truncate a log blob. Page 1 = newest `lineLimit` lines; higher pages walk
 * older. Mirrors coolify-mcp's truncateLogs semantics (lineLimit 200, charLimit 50K).
 */
export function truncateLogs(logs, lineLimit = 200, charLimit = 50000, page = 1) {
    const lines = logs.split("\n");
    const total = lines.length;
    const end = Math.max(0, total - (page - 1) * lineLimit);
    const start = Math.max(0, end - lineLimit);
    let slice = lines.slice(start, end).join("\n");
    if (slice.length > charLimit) {
        slice = "…[truncated]…\n" + slice.slice(slice.length - charLimit);
    }
    return { logs: slice, total_lines: total, showing_start: start, showing_end: end };
}
//# sourceMappingURL=response.js.map