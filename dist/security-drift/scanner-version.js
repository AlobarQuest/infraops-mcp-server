// Asserts the DEPLOYED security-scan.sh was written against the output contract this
// parser understands. The marker `# SCANNER_OUTPUT_VERSION=N` is a bash comment in the
// scanner (NOT emitted to stdout); we read it from the deployed file and refuse to parse
// a contract we weren't written for. See scan-parser.ts for what version 1 means.
import * as fs from "node:fs";
/** The scanner output-contract version scan-parser.ts was written against. Bump in the
 *  SAME PR that changes the LINE shape or a detail form in scan-parser.ts. */
export const EXPECTED_SCANNER_OUTPUT_VERSION = 1;
const MARKER = /^#\s*SCANNER_OUTPUT_VERSION=(\d+)\s*$/m;
/** Read `# SCANNER_OUTPUT_VERSION=N` from the deployed scanner file. Returns null if the
 *  file is unreadable, the marker is absent, or the value is non-numeric. */
export function readScannerOutputVersion(scanPath) {
    let text;
    try {
        text = fs.readFileSync(scanPath, "utf8");
    }
    catch {
        return null;
    }
    const m = text.match(MARKER);
    if (!m)
        return null;
    const n = Number.parseInt(m[1], 10);
    return Number.isNaN(n) ? null : n;
}
/** Returns a skew Finding when the deployed scanner's output version != expected (or the
 *  marker is missing/unreadable); else null. Deny-by-default: anything we cannot positively
 *  verify as matching is a skew (fail loud). */
export function scannerVersionGate(scanPath, expected) {
    const v = readScannerOutputVersion(scanPath);
    if (v === expected)
        return null;
    return {
        severity: "FAIL",
        check: "scanner.output_version_skew",
        target: scanPath,
        detail: `deployed scanner output version ${v ?? "missing/unreadable"} != parser-expected ${expected} — ` +
            `parser cannot be trusted; run aborted. Reconcile with: cd ~/Projects/security-standards && make install`,
    };
}
//# sourceMappingURL=scanner-version.js.map