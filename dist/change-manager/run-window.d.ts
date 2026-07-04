import type { ApprovedItem, OutcomeBody } from './api-client.js';
import type { ChangeOutcome } from './agent.js';
export interface WindowDeps {
    getApproved: () => Promise<ApprovedItem[]>;
    claim: (id: number) => Promise<void>;
    runAgent: (item: ApprovedItem) => Promise<ChangeOutcome>;
    postOutcome: (id: number, body: OutcomeBody) => Promise<void>;
    maxChangesPerWindow: number;
}
export interface WindowSummary {
    considered: number;
    applied: number;
    failed: number;
    blocked: number;
    skipped: number;
    results: Array<{
        name: string;
        outcome: string;
        detail: string;
    }>;
}
/**
 * The window executor core. Pulls approved items, claims each (skipping on a 409/claim error),
 * runs the agent, posts the outcome. Per-item isolation; capped at maxChangesPerWindow.
 */
export declare function runWindow(deps: WindowDeps): Promise<WindowSummary>;
//# sourceMappingURL=run-window.d.ts.map