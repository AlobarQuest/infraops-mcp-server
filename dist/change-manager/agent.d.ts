import Anthropic from "@anthropic-ai/sdk";
import type { ApprovedItem } from "./api-client.js";
import { deploymentSucceeded, httpsLive, type ToolCtx } from "./tools.js";
export interface ChangeOutcome {
    outcome: "done" | "blocked" | "failed" | "skipped_conformant";
    detail: string;
    rollback: Record<string, unknown>;
    tool_calls: {
        calls: Array<{
            name: string;
            input: unknown;
            result: string;
            is_error?: boolean;
        }>;
    };
}
type ToolCalls = ChangeOutcome["tool_calls"]["calls"];
/** Injectable deps for post-verify — real defaults in prod, fast fakes in tests. */
export interface PostVerifyDeps {
    deploymentSucceeded: typeof deploymentSucceeded;
    httpsLive: typeof httpsLive;
    pollAttempts: number;
    pollDelayMs: number;
    sleep: (ms: number) => Promise<void>;
}
export interface AgentDeps {
    client?: Anthropic;
    maxSteps?: number;
}
/**
 * Post-verify a 'done': re-fetch live and confirm the change actually took. If not,
 * revert via the captured rollback and return a 'failed' outcome to substitute.
 * Returns null to keep 'done'. A post-verify *read* error is inconclusive → keep 'done'
 * (don't revert a possibly-good change on a transient read failure).
 *
 * SCOPE (BACKLOG #5 — CLOSED): the HTTPS path now verifies three layers beyond the
 * config field: (B) a `redeploy_application` call ran without error, (A) the deployment
 * it triggered reached success (bounded poll), and the live TLS cert validates. A failed
 * or never-run redeploy, a failed deployment, or an invalid cert now yields `failed` +
 * revert instead of `done`. A *read*-side inconclusive (deployment status unknown/pending
 * on a clean redeploy, or a transient fetch error) conservatively keeps `done` — we never
 * revert a possibly-good change on a read failure.
 */
export declare function postVerifyOrRevert(item: ApprovedItem, ctx: ToolCtx, calls: ToolCalls, deps?: PostVerifyDeps): Promise<ChangeOutcome | null>;
/**
 * Run one approved item through the Sonnet tool-use loop. Acts only via the curated tools.
 * Never throws: any failure resolves to outcome "failed". report_done → done; report_blocked → blocked;
 * exceeding maxSteps without a report → failed.
 */
export declare function runChangeAgent(item: ApprovedItem, deps?: AgentDeps): Promise<ChangeOutcome>;
export {};
//# sourceMappingURL=agent.d.ts.map