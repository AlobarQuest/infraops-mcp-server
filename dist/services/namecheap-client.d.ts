/**
 * Namecheap API client.
 *
 * Wraps the Namecheap XML API for domain and DNS management.
 * Supports both sandbox and production environments via NAMECHEAP_USE_SANDBOX.
 *
 * Namecheap API specifics:
 *   - All requests are GET with query parameters (despite being mutations)
 *   - Responses are XML, parsed to JS objects
 *   - Auth is via ApiUser + ApiKey + ClientIp query params on every request
 *   - Commands use dot notation: namecheap.domains.getList, etc.
 */
export interface NamecheapResponse {
    Status: string;
    Errors?: {
        Error?: {
            _text: string;
            Number: number;
        } | Array<{
            _text: string;
            Number: number;
        }>;
    };
    CommandResponse: Record<string, unknown>;
    Server: string;
    GMTTimeDifference: string;
    ExecutionTime: number;
}
export interface NamecheapHostRecord {
    HostId?: number;
    Name: string;
    Type: string;
    Address: string;
    MXPref: number;
    TTL: number;
    AssociatedAppTitle?: string;
    FriendlyName?: string;
    IsActive?: boolean;
    IsDDNSEnabled?: boolean;
}
export interface NamecheapDomain {
    ID: number;
    Name: string;
    User: string;
    Created: string;
    Expires: string;
    IsExpired: boolean;
    IsLocked: boolean;
    AutoRenew: boolean;
    WhoisGuard: string;
    IsPremium: boolean;
    IsOurDNS: boolean;
}
/**
 * Execute a Namecheap API command.
 *
 * All Namecheap API calls use GET with query parameters.
 * The response is XML which we parse to a JS object.
 */
export declare function namecheapCommand(command: string, params?: Record<string, string | number | boolean>): Promise<NamecheapResponse>;
export declare class NamecheapApiError extends Error {
    code?: number;
    constructor(message: string, code?: number);
}
export declare function handleNamecheapError(error: unknown): string;
/** Check if Namecheap API is configured */
export declare function isNamecheapConfigured(): boolean;
/** Get current environment label */
export declare function getNamecheapEnvironment(): string;
/**
 * Split a domain string into SLD and TLD.
 * e.g. "example.com" → { sld: "example", tld: "com" }
 * e.g. "sub.example.co.uk" → { sld: "sub.example", tld: "co.uk" }
 */
export declare function splitDomain(domain: string): {
    sld: string;
    tld: string;
};
//# sourceMappingURL=namecheap-client.d.ts.map