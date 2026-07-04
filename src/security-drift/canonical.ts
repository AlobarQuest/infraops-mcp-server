// Deterministic JSON + plan hashing. The emit side (security-drift-cli) and the
// 4am executor (security-executor) MUST compute identical hashes for the SAME plan
// content, regardless of key order, so the integrity gate works across the round-trip
// through the change-manager DB (which stores the plan as an opaque JSON object).

import { createHash } from 'node:crypto';

/** Stable stringify: object keys sorted recursively; arrays preserve order. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** sha256 over the canonical form of a remediation plan. */
export function planHash(plan: unknown): string {
  return createHash('sha256').update(canonicalJSON(plan)).digest('hex');
}
