import type { Proposal, Risk } from "./check-engine.js";
import type { AuditResult } from "./run-audit.js";
import type { CoolifyInstance } from "../services/coolify-client.js";
/** One audited instance's slice of a drift report. */
export interface InstanceSection {
    ok: boolean;
    standards_source?: AuditResult["meta"]["standards_source"];
    summary?: AuditResult["summary"];
    proposals?: Proposal[];
    /** Per-endpoint read errors (instance partially reachable). */
    errors?: string[];
    /** Instance-level hard failure (the audit threw — e.g. instance unreachable). */
    error?: string;
}
export interface DeltaItem {
    instance: string;
    identity: string;
    description: string;
    risk: string;
    reasoning: string;
}
export interface DriftDelta {
    new: DeltaItem[];
    resolved: DeltaItem[];
    unchanged: number;
}
export interface DriftTotals {
    total_proposals: number;
    by_risk: Record<Risk, number>;
    by_kind: {
        remediation: number;
        question: number;
    };
    instances_ok: number;
    instances_failed: number;
}
export interface DriftReport {
    generated_at: string;
    instances: Record<string, InstanceSection>;
    totals: DriftTotals;
    delta: DriftDelta;
}
export type AuditFn = (instance: CoolifyInstance) => Promise<AuditResult>;
/**
 * Stable identity for a proposal across runs. The proposal `id` carries a random
 * suffix (nanoid8) so it cannot be compared directly; the prefix before the colon
 * is the remediation_key/rule_id, which together with the instance and target uuid
 * is stable for "the same deviation on the same resource".
 */
export declare function proposalIdentity(instance: string, p: Proposal): string;
/**
 * Day-over-day delta. A prior proposal counts as `resolved` ONLY when its instance
 * was successfully audited this run — if the instance is unreachable now (e.g. the
 * dev mini is offline) its prior deviations are *unknown*, not resolved, so we must
 * not falsely report them as fixed.
 */
export declare function diffProposals(prevInstances: Record<string, InstanceSection> | null, currInstances: Record<string, InstanceSection>): DriftDelta;
/**
 * Run the audit across instances and assemble a drift report with a delta versus
 * the previous report. The audit function is injected so this is testable without
 * network access. Each instance is isolated: a thrown audit becomes an `error`
 * section, never aborting the others.
 */
export declare function buildDriftReport(instances: CoolifyInstance[], auditFn: AuditFn, prevReport: DriftReport | null, generatedAt: string): Promise<DriftReport>;
/**
 * True when at least one instance was audited cleanly (ok, with no read errors).
 * Used to gate the heartbeat: a run where every instance errored out (e.g. missing
 * tokens) must NOT look healthy just because it produced "0 deviations".
 */
export declare function wasCleanlyAudited(report: DriftReport): boolean;
/** Deterministic human-readable summary for the daily email digest. */
export declare function renderMarkdown(report: DriftReport): string;
//# sourceMappingURL=report.d.ts.map