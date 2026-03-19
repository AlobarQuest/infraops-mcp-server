/**
 * Coolify API client.
 *
 * Centralises all HTTP communication with the Coolify REST API.
 * Every tool delegates to this client — no tool should import axios directly.
 */
export declare function coolifyGet<T>(endpoint: string, params?: Record<string, unknown>): Promise<T>;
export declare function coolifyPost<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function coolifyPatch<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function coolifyDelete<T>(endpoint: string): Promise<T>;
export declare function handleCoolifyError(error: unknown): string;
//# sourceMappingURL=coolify-client.d.ts.map