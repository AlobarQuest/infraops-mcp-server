export type Severity = "FAIL" | "WARN" | "PASS";
export interface Finding {
    severity: Severity;
    /** stable check key, e.g. "credfile.over_permissive" */
    check: string;
    /** full detail text the scanner emitted (key-names only, no secret values) */
    detail: string;
    /** the path/resource the finding is about — used for autofix-allowlist match + fingerprinting */
    target: string;
}
/**
 * Extract the stable target (path/resource) from a finding's detail.
 * Path-bearing checks emit either `<path> (mode NNN) ...` or `<file>: <rest>`.
 * Everything else (listeners, os toggles, supply) uses the whole detail as the
 * discriminator — stable enough for fingerprinting.
 */
export declare function extractTarget(detail: string): string;
/** Parse scanner stdout into findings. Non-matching lines (headers, summary) are skipped. */
export declare function parseScan(stdout: string): Finding[];
//# sourceMappingURL=scan-parser.d.ts.map