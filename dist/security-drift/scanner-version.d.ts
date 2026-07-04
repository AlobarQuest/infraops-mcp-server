import type { Finding } from './scan-parser.js';
/** The scanner output-contract version scan-parser.ts was written against. Bump in the
 *  SAME PR that changes the LINE shape or a detail form in scan-parser.ts. */
export declare const EXPECTED_SCANNER_OUTPUT_VERSION = 1;
/** Read `# SCANNER_OUTPUT_VERSION=N` from the deployed scanner file. Returns null if the
 *  file is unreadable, the marker is absent, or the value is non-numeric. */
export declare function readScannerOutputVersion(scanPath: string): number | null;
/** Returns a skew Finding when the deployed scanner's output version != expected (or the
 *  marker is missing/unreadable); else null. Deny-by-default: anything we cannot positively
 *  verify as matching is a skew (fail loud). */
export declare function scannerVersionGate(scanPath: string, expected: number): Finding | null;
//# sourceMappingURL=scanner-version.d.ts.map