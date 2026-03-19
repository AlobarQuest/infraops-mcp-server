/**
 * Hetzner Cloud API client.
 *
 * Wraps the Hetzner Cloud REST API at https://api.hetzner.cloud/v1.
 * Used for cloud-level management: servers, firewalls, SSH keys, volumes,
 * snapshots, networks, floating IPs.
 */
export declare function hetznerGet<T>(endpoint: string, params?: Record<string, unknown>): Promise<T>;
export declare function hetznerPost<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function hetznerPut<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function hetznerDelete<T>(endpoint: string): Promise<T>;
export declare function handleHetznerError(error: unknown): string;
/** Check if Hetzner API is configured */
export declare function isHetznerConfigured(): boolean;
//# sourceMappingURL=hetzner-client.d.ts.map