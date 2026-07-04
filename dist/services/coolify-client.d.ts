/**
 * Coolify API client — multi-instance support.
 *
 * Supports multiple Coolify instances (e.g. "prod" and "dev") via
 * environment variables. Every public helper accepts an optional
 * `instance` parameter that defaults to "prod".
 *
 * Env vars:
 *   COOLIFY_PROD_BASE_URL / COOLIFY_PROD_API_TOKEN  (or legacy COOLIFY_BASE_URL / COOLIFY_API_TOKEN)
 *   COOLIFY_DEV_BASE_URL  / COOLIFY_DEV_API_TOKEN   (optional)
 */
export type CoolifyInstance = 'prod' | 'dev';
export declare function isCoolifyInstanceConfigured(instance: CoolifyInstance): boolean;
export declare function getConfiguredInstances(): CoolifyInstance[];
export declare function getCoolifyInstanceUrl(instance: CoolifyInstance): string | undefined;
export declare function coolifyGet<T>(endpoint: string, params?: Record<string, unknown>, instance?: CoolifyInstance): Promise<T>;
export declare function coolifyPost<T>(endpoint: string, data?: Record<string, unknown>, instance?: CoolifyInstance): Promise<T>;
export declare function coolifyPatch<T>(endpoint: string, data?: Record<string, unknown>, instance?: CoolifyInstance): Promise<T>;
export declare function coolifyDelete<T>(endpoint: string, instance?: CoolifyInstance): Promise<T>;
export declare function handleCoolifyError(error: unknown): string;
//# sourceMappingURL=coolify-client.d.ts.map