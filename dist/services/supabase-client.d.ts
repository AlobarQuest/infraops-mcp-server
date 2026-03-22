/**
 * Supabase Management API client.
 *
 * Wraps the Supabase Management API at https://api.supabase.com/v1.
 * Used for project lifecycle, database queries, Edge Functions,
 * secrets, auth config, and storage bucket management.
 */
export declare function supabaseGet<T>(endpoint: string, params?: Record<string, unknown>): Promise<T>;
export declare function supabasePost<T>(endpoint: string, data?: unknown): Promise<T>;
export declare function supabasePut<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function supabasePatch<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function supabaseDelete<T>(endpoint: string, data?: unknown): Promise<T>;
export declare function handleSupabaseError(error: unknown): string;
/** Check if Supabase Management API is configured */
export declare function isSupabaseConfigured(): boolean;
//# sourceMappingURL=supabase-client.d.ts.map