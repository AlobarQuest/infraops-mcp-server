import type { ApprovedItem, OutcomeBody } from './api-client.js';
import type { ChangeOutcome } from './agent.js';
export type Instance = 'prod' | 'dev';
export interface SelectOptions {
    maxChangesPerWindow: number;
    /** Keep only items for this Coolify instance; undefined keeps both. */
    instance?: Instance;
}
export interface WindowDeps extends SelectOptions {
    getApproved: () => Promise<ApprovedItem[]>;
    claim: (id: number) => Promise<void>;
    runAgent: (item: ApprovedItem) => Promise<ChangeOutcome>;
    postOutcome: (id: number, body: OutcomeBody) => Promise<void>;
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
 * The items a window would claim, in order. A dry run and a real run both select through here.
 * The instance filter runs before the cap, so items for the other instance never use up a slot.
 */
export declare function selectItems(items: ApprovedItem[], opts: SelectOptions): ApprovedItem[];
/**
 * The window executor core. Pulls approved items, claims each (skipping on a 409/claim error),
 * runs the agent, posts the outcome. Per-item isolation; capped at maxChangesPerWindow.
 */
export declare function runWindow(deps: WindowDeps): Promise<WindowSummary>;
//# sourceMappingURL=run-window.d.ts.map