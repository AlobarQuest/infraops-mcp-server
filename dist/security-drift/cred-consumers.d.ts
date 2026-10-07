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
    /** Basic-auth probe context for non-Bearer providers (e.g. bitbucket). Non-secret. */
    probe_email?: string;
    probe_workspace?: string;
    created?: string;
    last_rotated?: string;
    /** On-demand rotation request ("YYYY-MM-DD", UTC). Raises cred.rotation-requested from
     *  that date until a rotation is recorded on or after it. */
    rotate_requested?: string;
    /** Raw text of a rotate_requested that is not a quoted real date. Contained to this
     *  credential (cred.invalid-rotate-requested) rather than failing the whole registry. */
    rotate_requested_invalid?: string;
    /** The SDS owns this credential's rotation (ADR-0054). The 03:00 scan posts none of its
     *  rotation findings to change-manager and the 04:00 window refuses its rotation plans; the
     *  orchestrator's rotation proposer reads them through `cred-findings` instead.
     *  Set it only when no legacy rotation is in flight: the next 03:00 sync resolves the
     *  credential's open security item, stranding a half-done reissue's quarantine copy. */
    rotated_by_sds?: boolean;
    rotation_preconditions: string[];
    consumers: ConsumerSpec[];
    exposures: ExposureSpec[];
}
/** UTC midnight of a strict `YYYY-MM-DD` that names a real calendar date, else null. */
export declare function parseIsoDay(text: string): number | null;
/** Parse one .cred-consumers.toml document. Throws CredConsumersParseError on any deviation. */
export declare function parseCredConsumers(text: string): CredentialSpec[];
/**
 * Load every listed .cred-consumers.toml. A missing list file or empty list means
 * NO managed credentials (deny-by-default) — rotation detection simply emits nothing.
 * A listed-but-unreadable/unparseable file throws (the caller escalates, never guesses).
 */
export declare function loadCredConsumerFiles(files: string[]): CredentialSpec[];
//# sourceMappingURL=cred-consumers.d.ts.map