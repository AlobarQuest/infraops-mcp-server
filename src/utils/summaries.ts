/**
 * Summary projections for Coolify list/overview responses.
 *
 * Coolify list endpoints return ~60-95 fields per row; the full payload blows the
 * LLM context budget on instances with many resources. These projectors keep the
 * handful of fields an agent actually needs to triage and drill in. List tools
 * default to `summary: true`; pass `summary: false` for the full objects.
 */

function pick<T extends Record<string, any>>(obj: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (obj && k in obj) out[k] = obj[k];
  }
  return out;
}

export const toApplicationSummary = (a: Record<string, any>) =>
  pick(a, ['uuid', 'name', 'status', 'fqdn', 'git_repository', 'git_branch', 'build_pack']);

export const toDatabaseSummary = (d: Record<string, any>) =>
  pick(d, ['uuid', 'name', 'status', 'is_public', 'environment_name']);

export const toServiceSummary = (s: Record<string, any>) =>
  pick(s, ['uuid', 'name', 'status', 'fqdn']);

export const toServerSummary = (s: Record<string, any>) =>
  pick(s, ['uuid', 'name', 'ip', 'status', 'is_reachable']);

export const toProjectSummary = (p: Record<string, any>) =>
  pick(p, ['uuid', 'name', 'description']);

export const toGitHubAppSummary = (g: Record<string, any>) =>
  pick(g, ['id', 'uuid', 'name', 'organization', 'is_public', 'app_id']);

/** Apply a projector to an array iff `summary` is truthy; otherwise pass through. */
export function summarize<T extends Record<string, any>>(
  items: T[],
  projector: (x: Record<string, any>) => Record<string, unknown>,
  summary: boolean,
): unknown[] {
  if (!Array.isArray(items)) return items as unknown[];
  return summary ? items.map((i) => projector(i)) : items;
}
