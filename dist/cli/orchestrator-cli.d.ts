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
/**
 * The follow-up minting pass (WS-P2.8). Uses ORCHESTRATOR_MINT_TOKEN / orchestrator-system --
 * NOT the drift-reporter credential this file's `observe` command uses. That actor's registry
 * profile is observe-and-propose; minting a work unit is canonical mutation, and agent_id
 * attribution is permanent.
 */
export declare function makeMintClient(): OrchestratorClient;
export declare function doMintFollowUps(dryRun: boolean): Promise<void>;
export declare function doObserve(reportDir: string, now: string, dryRun: boolean): Promise<void>;
//# sourceMappingURL=orchestrator-cli.d.ts.map