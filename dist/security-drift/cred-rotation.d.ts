import type { Finding } from './scan-parser.js';
import type { Classification } from './taxonomy.js';
import { type CredentialSpec } from './cred-consumers.js';
interface ClassPolicy {
    maxAgeDays: number;
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
/** When a credential last rotated, as far as anything knows: the date its age is measured from. */
export declare function rotationAnchor(spec: CredentialSpec, state: RotationState): string | undefined;
export declare function credTarget(credId: string): string;
/** What the registry alone says, with no rotation state: the 03:00 scan's credential findings
 *  (ADR-0059 amendment 12 item 3). The rotation triggers are the rotation proposer's to raise.
 *  An unknown class is raised whether or not the credential has an exposure, because without
 *  the state the scan cannot tell an open exposure from a resolved one. Pure — no I/O. */
export declare function registryFindings(specs: CredentialSpec[]): Finding[];
/** Findings for the current registry + state. Pure — no I/O. */
export declare function credFindings(specs: CredentialSpec[], state: RotationState, now: string): Finding[];
/**
 * Build the Classification for every managed credential's findings, keyed by
 * `${check}|${target}` (the lookup the taxonomy uses for cred.* checks).
 */
export declare function buildCredClassifications(specs: CredentialSpec[]): Record<string, Classification>;
export {};
//# sourceMappingURL=cred-rotation.d.ts.map