/**
 * Summary projections for Coolify list/overview responses.
 *
 * Coolify list endpoints return ~60-95 fields per row; the full payload blows the
 * LLM context budget on instances with many resources. These projectors keep the
 * handful of fields an agent actually needs to triage and drill in. List tools
 * default to `summary: true`; pass `summary: false` for the full objects.
 */
function pick(obj, keys) {
    const out = {};
    for (const k of keys) {
        if (obj && k in obj)
            out[k] = obj[k];
    }
    return out;
}
export const toApplicationSummary = (a) => pick(a, ['uuid', 'name', 'status', 'fqdn', 'git_repository', 'git_branch', 'build_pack']);
export const toDatabaseSummary = (d) => pick(d, ['uuid', 'name', 'status', 'is_public', 'environment_name']);
export const toServiceSummary = (s) => pick(s, ['uuid', 'name', 'status', 'fqdn']);
export const toServerSummary = (s) => pick(s, ['uuid', 'name', 'ip', 'status', 'is_reachable']);
export const toProjectSummary = (p) => pick(p, ['uuid', 'name', 'description']);
export const toGitHubAppSummary = (g) => pick(g, ['id', 'uuid', 'name', 'organization', 'is_public', 'app_id']);
/** Apply a projector to an array iff `summary` is truthy; otherwise pass through. */
export function summarize(items, projector, summary) {
    if (!Array.isArray(items))
        return items;
    return summary ? items.map((i) => projector(i)) : items;
}
//# sourceMappingURL=summaries.js.map