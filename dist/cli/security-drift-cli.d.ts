#!/usr/bin/env node
import type { Finding } from '../security-drift/scan-parser.js';
import type { Classification } from '../security-drift/taxonomy.js';
export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
/** Record a verified rotation (or a no-replacement credential's confirmed revoke):
 *  sets lastRotated for a registry credential, which clears its rotation-age and
 *  rotation-requested findings from `cred-findings`. */
export declare function doRecordRotation(args: Record<string, string | boolean>): void;
/** The registry's contribution to the 03:00 scan: the findings the registry alone supports
 *  (`registryFindings`) and the pre-built classifications. It reads no rotation state: the
 *  rotation triggers are the rotation proposer's to raise (ADR-0059 amendment 12 item 3). */
export declare function credScan(listFile: string): {
    findings: Finding[];
    classifications: Record<string, Classification> | undefined;
};
/** The credential-rotation findings as JSON, for the orchestrator's rotation proposer
 *  (ADR-0054 amendment 1). READ-ONLY: it loads the listed registries and the rotation state
 *  and writes nothing. Only `cred.*` findings that carry `facts` are
 *  printed, each as its check plus those fields -- never the prose detail. `last_rotated` is
 *  additive, so `schema_version` stays 1. A registry that does not parse throws, so the caller gets a non-zero exit rather than an empty list. */
export declare function doCredFindings(args: Record<string, string | boolean>): void;
export declare function main(argv?: string[]): Promise<void>;
//# sourceMappingURL=security-drift-cli.d.ts.map