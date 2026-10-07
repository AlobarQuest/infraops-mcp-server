#!/usr/bin/env node
export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
/** Which rotation plans the window must refuse, from the live registry: any credential the SDS
 *  rotates, and any credential the registry does not hold (so a list naming no file refuses
 *  everything). A registry that cannot be read refuses every plan. */
export declare function rotationRefusals(listFile: string): (credId: string) => boolean;
//# sourceMappingURL=change-mgr-cli.d.ts.map