/**
 * Shared response helpers for Coolify tools.
 *
 * Centralizes the `{ content: [{ type: "text", text }] }` shape. `jsonResponse`
 * is serialize-only — truncation (CHARACTER_LIMIT, 25K) moved to `truncateToLimit`
 * and is applied centrally by the redaction wrapper (register-sanitized.ts) after
 * redaction, so a secret is never split across a truncation boundary.
 */
import { CHARACTER_LIMIT } from "../constants.js";
/** Truncate text to `charLimit` with an explicit narrowing marker. */
export function truncateToLimit(text, charLimit = CHARACTER_LIMIT) {
    if (text.length <= charLimit)
        return text;
    const keep = Math.max(0, charLimit - 220);
    const kb = Math.round(charLimit / 1000);
    return (text.slice(0, keep) +
        `\n…[truncated: response exceeded ${kb}K chars — narrow it with summary:true, ` +
        `pagination (page/per_page), or a more specific UUID/query]…`);
}
/**
 * Build a JSON tool response. Serialize-only — truncation is applied centrally by
 * the redaction wrapper (register-sanitized.ts) AFTER redaction, so a secret can
 * never be split across the truncation boundary.
 */
export function jsonResponse(data, _opts = {}) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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