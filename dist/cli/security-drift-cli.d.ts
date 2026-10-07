#!/usr/bin/env node
import type { Finding } from '../security-drift/scan-parser.js';
import type { Classification } from '../security-drift/taxonomy.js';
export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
/** Record a verified rotation (or a no-replacement credential's confirmed revoke):
 *  sets lastRotated for a registry credential, which clears its rotation-age and
 *  rotation-requested findings on the next 3am run. */
export declare function doRecordRotation(args: Record<string, string | boolean>): void;
/** The credential-rotation findings as JSON, for the orchestrator's rotation proposer
 *  (ADR-0054 amendment 1). READ-ONLY: it loads the listed registries and the rotation state
 *  exactly as `run` does and writes nothing. Only `cred.*` findings that carry `facts` are
 *  printed, each as its check plus those fields -- never the prose detail. A registry that does
 *  not parse throws, so the caller gets a non-zero exit rather than an empty list. */
/** The registry's contribution to the 03:00 scan: its findings, less the rotation triggers of
 *  credentials the SDS rotates (`scanFindings`), and their pre-built classifications. */
export declare function credScan(listFile: string, stateFile: string, now: string): {
    findings: Finding[];
    classifications: Record<string, Classification> | undefined;
};
export declare function doCredFindings(args: Record<string, string | boolean>): void;
export declare function main(argv?: string[]): Promise<void>;
//# sourceMappingURL=security-drift-cli.d.ts.map