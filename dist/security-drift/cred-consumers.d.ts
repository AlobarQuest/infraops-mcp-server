export declare class CredConsumersParseError extends Error {
    constructor(message: string);
}
export interface ConsumerSpec {
    kind: string;
    uuid?: string;
    service?: string;
    account?: string;
    instance?: string;
    resource_type?: string;
    key?: string;
    redeploy?: boolean;
    repo?: string;
    name?: string;
    file?: string;
    var?: string;
    note?: string;
}
export interface ExposureSpec {
    id: string;
    date: string;
    source?: string;
}
export interface CredentialSpec {
    id: string;
    class: string;
    fingerprint_sha256_8?: string;
    provider?: string;
    provider_identity?: string;
    bws_uuid?: string;
    consumers_verified?: string;
    verified_by?: string;
    disposition?: string;
    replacement_scope?: string;
    created?: string;
    last_rotated?: string;
    rotation_preconditions: string[];
    consumers: ConsumerSpec[];
    exposures: ExposureSpec[];
}
/** Parse one .cred-consumers.toml document. Throws CredConsumersParseError on any deviation. */
export declare function parseCredConsumers(text: string): CredentialSpec[];
/**
 * Load every listed .cred-consumers.toml. A missing list file or empty list means
 * NO managed credentials (deny-by-default) — rotation detection simply emits nothing.
 * A listed-but-unreadable/unparseable file throws (the caller escalates, never guesses).
 */
export declare function loadCredConsumerFiles(files: string[]): CredentialSpec[];
//# sourceMappingURL=cred-consumers.d.ts.map