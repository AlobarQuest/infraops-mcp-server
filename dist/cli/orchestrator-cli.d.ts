#!/usr/bin/env node
import { OrchestratorClient } from '../orchestrator/api-client.js';
export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
export declare function makeClient(): OrchestratorClient;
/**
 * The counted summary line. Kept as one exported function so a dropped-instance regression (F1)
 * and a client-construction failure (F4) both go through the same, tested formatting -- neither
 * path can silently omit the `skipped=` clause or the count.
 */
export declare function formatSummaryLine(posted: number, failed: number, skipped: string[], total: number): string;
export declare function doObserve(reportDir: string, now: string, dryRun: boolean): Promise<void>;
//# sourceMappingURL=orchestrator-cli.d.ts.map