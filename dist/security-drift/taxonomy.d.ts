import type { Finding } from "./scan-parser.js";
export type Tier = "AUTO_FIX" | "URGENT" | "NORMAL";
/** A remediation is EITHER a list of exact commands to run verbatim, OR human steps. */
export type Remediation = {
    exec: string[][];
} | {
    manual: string[];
};
export interface Classification {
    tier: Tier;
    kind: "remediation" | "question";
    risk: "safe" | "caution" | "destructive";
    remediation: Remediation;
    title: string;
}
export interface ClassifyOptions {
    /** Explicit path-allowlist for chmod auto-fix. Deny-by-default: empty ⇒ nothing auto-fixes. */
    autoFixAllowlist: string[];
    /** Extra false-positive path/detail substrings to drop, beyond the built-ins. */
    fpExtra?: string[];
}
/** True when a finding should be dropped as a known false positive. */
export declare function isFalsePositive(f: Finding, opts: ClassifyOptions): boolean;
/**
 * Classify a single finding. Returns null when it is a known false positive (dropped).
 * Only FAIL/WARN findings should be passed in; PASS findings are not drift.
 */
export declare function classify(f: Finding, opts: ClassifyOptions): Classification | null;
//# sourceMappingURL=taxonomy.d.ts.map