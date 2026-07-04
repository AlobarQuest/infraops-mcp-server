import type { Finding } from './scan-parser.js';
import type { Classification } from './taxonomy.js';
import type { ConsumerSpec, CredentialSpec } from './cred-consumers.js';
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
export declare function credTarget(credId: string): string;
/** Findings for the current registry + state. Pure — no I/O. */
export declare function credFindings(specs: CredentialSpec[], state: RotationState, now: string): Finding[];
/** The executor-runnable rotation plan — hash-gated verbatim through change-manager.
 *  NO secret value ever appears here: everything is referenced by BWS UUID,
 *  Keychain item name, or consumer coordinates. */
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