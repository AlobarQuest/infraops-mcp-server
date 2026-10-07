#!/usr/bin/env node
export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
/** Which credentials the SDS rotates, from the live registry. An unreadable registry cannot say
 *  which credentials are the SDS's, so every rotation plan is refused rather than guessed. */
export declare function sdsRotatedCredentials(listFile: string): (credId: string) => boolean;
//# sourceMappingURL=change-mgr-cli.d.ts.map