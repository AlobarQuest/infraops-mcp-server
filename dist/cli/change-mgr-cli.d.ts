#!/usr/bin/env node
import { ChangeMgrClient } from '../change-manager/api-client.js';
import { type Instance, type WindowDeps } from '../change-manager/run-window.js';
export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
/**
 * `parseArgs` reads `--name=value` as the key `name=value` and keeps any unknown flag, so either
 * would be silently ignored: `--instance=prod` would run both instances. Reject both. The message
 * names only the flag, never its value.
 */
export declare function checkRunWindowFlags(argv: string[]): void;
/** `--instance prod|dev`; absent keeps both instances. Throws on any other value or no value. */
export declare function parseInstance(value: string | boolean | undefined): Instance | undefined;
/** `--dry-run` is a bare flag; a value after it is a mistyped command, not a dry run. */
export declare function parseDryRun(value: string | boolean | undefined): boolean;
type WindowClient = Pick<ChangeMgrClient, 'getApproved' | 'claim' | 'postOutcome' | 'startWindow' | 'finishWindow'>;
export interface RunWindowOptions {
    reportDir?: string;
    now: string;
    instance?: Instance;
    dryRun: boolean;
}
/**
 * Runs the change window. `makeAgent` is called only for a real run, so a dry run needs no
 * Anthropic key. A dry run lists approved items, applies the same selection, prints the ids it
 * would claim as one JSON line, and changes nothing.
 */
export declare function doRunWindow(c: WindowClient, makeAgent: () => WindowDeps['runAgent'], opts: RunWindowOptions): Promise<void>;
export declare function main(argv?: string[]): Promise<void>;
export {};
//# sourceMappingURL=change-mgr-cli.d.ts.map