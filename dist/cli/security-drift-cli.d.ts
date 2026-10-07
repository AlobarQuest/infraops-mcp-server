#!/usr/bin/env node
export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
/** Record a verified rotation (or a no-replacement credential's confirmed revoke):
 *  sets lastRotated for a registry credential, which clears its rotation-age and
 *  rotation-requested findings on the next 3am run. */
export declare function doRecordRotation(args: Record<string, string | boolean>): void;
export declare function main(argv?: string[]): Promise<void>;
//# sourceMappingURL=security-drift-cli.d.ts.map