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
export declare const SENSITIVE_RESOURCE_FIELDS: readonly ["manual_webhook_secret_github", "manual_webhook_secret_gitlab", "manual_webhook_secret_gitea", "manual_webhook_secret_bitbucket", "http_basic_auth_password"];
/** Mask sensitive fields on a single resource object (non-mutating). */
export declare function maskSensitive<T extends Record<string, any>>(obj: T, reveal?: boolean): T;
/** Mask sensitive fields across an array of resource objects. */
export declare function maskSensitiveList<T extends Record<string, any>>(arr: T[], reveal?: boolean): T[];
//# sourceMappingURL=masking.d.ts.map