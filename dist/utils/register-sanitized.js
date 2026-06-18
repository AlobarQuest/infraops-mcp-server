/**
 * Central secret-redaction chokepoint. `installRedaction(server)` patches
 * `server.registerTool` once so every tool (current + future) has:
 *   - an optional `reveal` injected into its input schema (only if absent), and
 *   - its handler result routed through redact-then-truncate.
 * 3-tier opt-out: default redact / `reveal:true` bypass / ALWAYS_BYPASS bypass.
 * Kill switch: INFRAOPS_DISABLE_REDACTION=1. Existing local masks remain as
 * defense-in-depth; this is the superset backstop.
 */
import { z } from "zod";
import { deepRedact, redactText } from "./redaction.js";
import { truncateToLimit } from "./response.js";
/** Value-read tools whose output IS the requested content — never redacted. */
export const ALWAYS_BYPASS = new Set([
    "vps_read_file",
    "vps_exec",
    "vps_docker_logs",
    "cloudflare_get_kv_value",
    "cloudflare_query_d1",
    "namecheap_domains_get_contacts",
]);
const REVEAL_FIELD = z
    .boolean()
    .default(false)
    .describe("Reveal redacted secret values in the response (default false; the call is audited)");
/** Redact one text blob: structured if JSON-parseable, else value-shape on the raw string. */
function redactTextContent(text) {
    try {
        return JSON.stringify(deepRedact(JSON.parse(text)), null, 2);
    }
    catch {
        return redactText(text);
    }
}
function sanitizeResult(result, name, args) {
    // ALWAYS_BYPASS tools return raw content the caller asked for — bypass BOTH
    // redaction AND truncation (they were unbounded before; truncating would cut
    // large file/query reads). All other tools: redact (unless reveal/kill-switch)
    // and always truncate for context-size safety.
    const isValueRead = ALWAYS_BYPASS.has(name);
    const bypassRedact = isValueRead ||
        process.env.INFRAOPS_DISABLE_REDACTION === "1" ||
        args?.reveal === true;
    if (!result || !Array.isArray(result.content))
        return result;
    const content = result.content.map((item) => {
        if (item?.type !== "text" || typeof item.text !== "string")
            return item;
        const redacted = bypassRedact ? item.text : redactTextContent(item.text);
        return { ...item, text: isValueRead ? redacted : truncateToLimit(redacted) };
    });
    return { ...result, content };
}
export function installRedaction(server) {
    const orig = server.registerTool.bind(server);
    server.registerTool = (name, config, cb) => {
        const cfg = config ?? {};
        if (!cfg.inputSchema)
            cfg.inputSchema = {};
        if (!("reveal" in cfg.inputSchema))
            cfg.inputSchema.reveal = REVEAL_FIELD;
        const wrapped = async (args, extra) => {
            const result = await cb(args, extra);
            return sanitizeResult(result, name, args);
        };
        return orig(name, cfg, wrapped);
    };
}
//# sourceMappingURL=register-sanitized.js.map