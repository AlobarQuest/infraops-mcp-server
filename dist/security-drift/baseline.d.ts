import type { Finding } from "./scan-parser.js";
import type { Classification, Tier } from "./taxonomy.js";
export declare class BaselineIntegrityError extends Error {
    constructor(message: string);
}
export interface BaselineEntry {
    firstSeen: string;
    tier: Tier;
}
export type Baseline = Record<string, BaselineEntry>;
/** Stable cross-run fingerprint for a finding. */
export declare function fingerprint(check: string, target: string): string;
/**
 * Load and validate the baseline. A missing file means "first run" → returns null so
 * the caller can SEED rather than treat every current finding as new drift.
 * A present file MUST be a regular file, mode 0600, owned by the current user.
 */
export declare function loadBaseline(file: string): Baseline | null;
/** Atomically write the baseline with mode 0600. */
export declare function saveBaseline(file: string, baseline: Baseline): void;
export interface DiffItem {
    fingerprint: string;
    finding: Finding;
    classification: Classification;
}
/**
 * Return findings that are NEW (not in baseline) or CHANGED (tier differs).
 * Suppresses findings whose fingerprint is in the baseline with the same tier.
 */
export declare function diffFindings(classified: {
    finding: Finding;
    classification: Classification;
}[], baseline: Baseline): DiffItem[];
/** Build a fresh baseline snapshot from the current classified findings. */
export declare function snapshot(classified: {
    finding: Finding;
    classification: Classification;
}[], now: string, prev?: Baseline): Baseline;
//# sourceMappingURL=baseline.d.ts.map