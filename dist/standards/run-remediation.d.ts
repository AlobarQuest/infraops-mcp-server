import type { CoolifyInstance } from "../services/coolify-client.js";
import type { AuditResult } from "./run-audit.js";
import type { Proposal } from "./check-engine.js";
import type { ApplyResult } from "./executor.js";
import type { RemediationPlan } from "./remediation-plan.js";
import { type DriftReport } from "./report.js";
import { type RemediationReport } from "./remediation-report.js";
export interface RemediationDeps {
    audit: (inst: CoolifyInstance) => Promise<AuditResult>;
    apply: (p: Proposal, inst: CoolifyInstance, opts: {
        dryRun?: boolean;
    }) => Promise<ApplyResult>;
    plan: (p: Proposal) => Promise<RemediationPlan>;
    maxAutoApplies: number;
    dryRun: boolean;
}
/**
 * The remediation core. Re-audits each instance LIVE (the idempotency guard —
 * we act on current reality, not the possibly-stale morning report), partitions
 * proposals into auto-applicable vs escalated, applies the safe ones (unless the
 * runaway guard trips), asks for a plan on the rest, and assembles the report.
 * Dependency-injected so it is fully testable without network or model access —
 * mirrors buildDriftReport in run-audit.ts / report.ts.
 */
export declare function runRemediation(instances: CoolifyInstance[], morning: DriftReport | null, generatedAt: string, sourceReport: string, deps: RemediationDeps): Promise<{
    report: RemediationReport;
    cleanlyAudited: boolean;
}>;
//# sourceMappingURL=run-remediation.d.ts.map