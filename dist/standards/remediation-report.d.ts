import type { ApplyResult } from "./executor.js";
import type { Proposal } from "./check-engine.js";
import type { RemediationPlan } from "./remediation-plan.js";
/** One escalated (non-auto-fixable) item plus its Sonnet/raw plan. The change-manager contract. */
export interface Escalation {
    proposal_id: string;
    instance: string;
    target: Proposal["target"];
    risk: string;
    kind: string;
    reasoning: string;
    plan: RemediationPlan;
    /** Why this was escalated rather than auto-applied (e.g. a verify gate held it). Absent for inherently-escalated items. */
    note?: string;
}
export interface RemediationReport {
    schema_version: number;
    generated_at: string;
    source_report: string;
    totals: {
        applied: number;
        skipped: number;
        failed: number;
        escalated: number;
        self_resolved: number;
        runaway_tripped: boolean;
    };
    applied: ApplyResult[];
    escalations: Escalation[];
}
export declare function buildRemediationReport(args: {
    generatedAt: string;
    sourceReport: string;
    applied: ApplyResult[];
    escalations: Escalation[];
    selfResolved: number;
    runawayTripped: boolean;
}): RemediationReport;
/** Human-readable digest for the daily consolidated email. */
export declare function renderRemediationMarkdown(r: RemediationReport): string;
//# sourceMappingURL=remediation-report.d.ts.map