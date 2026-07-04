/**
 * Secret masking for Coolify resource payloads.
 *
 * Coolify embeds several secrets directly in application/service/database objects:
 * the per-provider deploy-webhook HMAC keys (forging risk) and the HTTP basic-auth
 * password. infraops previously passed raw `get_*`/`list_*` objects straight to the
 * LLM. These helpers mask those fields by default; pass `reveal: true` to opt out
 * (mirrors the env-var `reveal` posture). `null`/absent values are preserved so the
 * response still conveys "no secret set". Env-var `value`/`real_value` masking is
 * handled separately in env-vars.ts.
 */

export const SENSITIVE_RESOURCE_FIELDS = [
  'manual_webhook_secret_github',
  'manual_webhook_secret_gitlab',
  'manual_webhook_secret_gitea',
  'manual_webhook_secret_bitbucket',
  'http_basic_auth_password',
] as const;

const MASKED_VALUE = '***';

/** Mask sensitive fields on a single resource object (non-mutating). */
export function maskSensitive<T extends Record<string, any>>(obj: T, reveal = false): T {
  if (reveal || obj == null || typeof obj !== 'object') return obj;
  const out: Record<string, any> = { ...obj };
  for (const field of SENSITIVE_RESOURCE_FIELDS) {
    if (out[field] != null) out[field] = MASKED_VALUE;
  }
  return out as T;
}

/** Mask sensitive fields across an array of resource objects. */
export function maskSensitiveList<T extends Record<string, any>>(arr: T[], reveal = false): T[] {
  if (reveal || !Array.isArray(arr)) return arr;
  return arr.map((o) => maskSensitive(o, false));
}
