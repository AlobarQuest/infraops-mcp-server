/**
 * Cloudflare API client.
 *
 * Wraps the Cloudflare REST API at https://api.cloudflare.com/client/v4.
 * Used for DNS, Pages, Workers, R2, Tunnels, WAF, and SSL management.
 */
/** Get the configured Cloudflare account ID */
export declare function getAccountId(): string;
export declare function cloudflareGet<T>(endpoint: string, params?: Record<string, unknown>): Promise<T>;
export declare function cloudflarePost<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function cloudflarePut<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function cloudflarePatch<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function cloudflareDelete<T>(endpoint: string): Promise<T>;
export declare function handleCloudflareError(error: unknown): string;
/** Check if Cloudflare API is configured */
export declare function isCloudflareConfigured(): boolean;
//# sourceMappingURL=cloudflare-client.d.ts.map