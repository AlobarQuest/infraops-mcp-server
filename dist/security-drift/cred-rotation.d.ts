import type { Finding } from './scan-parser.js';
import type { Classification } from './taxonomy.js';
import { type ConsumerSpec, type CredentialSpec } from './cred-consumers.js';
export type ProviderProbe = 'github' | 'openrouter' | 'openai' | 'bitbucket';
interface ClassPolicy {
    maxAgeDays: number;
    probe?: ProviderProbe;
    /** may this class produce an executor-runnable plan at all? */
    executor: boolean;
    /** class-specific landmine steps prepended to every manual checklist */
    landmines: string[];
}
export declare const CLASS_POLICY: Record<string, ClassPolicy>;
export declare const SUPPORTED_CONSUMER_KINDS: ReadonlySet<string>;
export declare class RotationStateIntegrityError extends Error {
    constructor(message: string);
}
export interface RotationState {
    /** key = `${credId}:${exposureId}` */
    resolvedExposures: Record<string, {
        ts: string;
        detail: string;
    }>;
    lastRotated: Record<string, string>;
}
export declare function loadRotationState(file: string): RotationState;
export declare function saveRotationState(file: string, state: RotationState): void;
/**
 * Record a verified rotation: set `lastRotated[credId]` to `date` — a strict
 * `YYYY-MM-DD` (UTC midnight) or `'now'`. Refuses an id outside the registry, a
 * revoke-no-replacement credential (its revoke is recorded by the executor's
 * revoke-confirm, and a lastRotated written here would not mark it revoked), a
 * malformed or impossible date, and a date after `now` (a future lastRotated would
 * silence the age finding). Mutates `state`; the caller persists it.
 */
export declare function recordRotation(state: RotationState, specs: readonly CredentialSpec[], credId: string, date: string, now: string): {
    previous: string | undefined;
    recorded: string;
};
/**
 * A revoke-no-replacement credential is recorded revoked when the executor's
 * revoke-confirm wrote it: completeRotation stamps the resolved exposure and
 * lastRotated with the same timestamp in one write. A lastRotated alone (an ordinary
 * rotation before a re-classification) is not a revoke.
 */
export declare function isRecordedRevoked(spec: CredentialSpec, state: RotationState): boolean;
export declare function credTarget(credId: string): string;
/** Findings for the current registry + state. Pure — no I/O. */
export declare function credFindings(specs: CredentialSpec[], state: RotationState, now: string): Finding[];
/** The executor-runnable rotation plan — hash-gated verbatim through change-manager.
 *  NO secret value ever appears here: everything is referenced by BWS UUID,
 *  Keychain item name, or consumer coordinates. */
/** The findings that start a rotation. For a credential the SDS rotates, these reach only the
 *  rotation proposer; every other finding about it (a bad registry field, an unknown class) is
 *  still the scan's to report. */
export declare const ROTATION_TRIGGER_CHECKS: ReadonlySet<string>;
/** What the 03:00 scan posts: every finding except the rotation triggers of SDS-rotated
 *  credentials, which would otherwise become change-manager security items the 04:00 window
 *  could act on outside the SDS. */
export declare function scanFindings(findings: Finding[], specs: CredentialSpec[]): Finding[];
export interface RotationPlanSpec {
    credId: string;
    credClass: string;
    fingerprint8?: string;
    consumersVerified: string;
    /** reissue path: Keychain staging item Devon fills with the NEW provider-minted value */
    staging?: {
        service: string;
        account: string;
    };
    /** reissue path: BWS keeper secret edited in place (UUID stays stable for by-UUID fetchers) */
    keeperBwsUuid?: string;
    /** reissue path: distinctly-named quarantine secret holding the OLD value until confirmed dead */
    quarantineName?: string;
    bwsProjectId?: string;
    /** revoke-no-replacement path: BWS secrets that HOLD the old value — probed until dead, then retired */
    retireBwsUuids: string[];
    consumers: ConsumerSpec[];
    providerProbe: ProviderProbe;
    /** Basic-auth probe context (bitbucket): the account email and workspace. Non-secret. */
    probeEmail?: string;
    probeWorkspace?: string;
    exposureIds: string[];
    /** Devon's console steps (create/revoke are ALWAYS human) — shown in change-manager */
    manualSteps: string[];
}
export declare const STAGING_SERVICE = "cred-rotation";
/**
 * Build the Classification for every managed credential's findings, keyed by
 * `${check}|${target}` (the lookup the taxonomy uses for cred.* checks).
 */
export declare function buildCredClassifications(specs: CredentialSpec[], state: RotationState): Record<string, Classification>;
export {};
//# sourceMappingURL=cred-rotation.d.ts.map