import type { DiffItem } from "./baseline.js";
import type { EmitState } from "./emit-state.js";
import type { Finding } from "./scan-parser.js";
import type { Classification, Remediation, Tier } from "./taxonomy.js";
export interface SecurityPlan {
    generated_by: "security-scan";
    tier: Tier;
    root_cause: string;
    remediation: Remediation;
    rollback: string;
    source: "security";
    blind_spots: string;
}
export interface SecurityEscalation {
    proposal_id: string;
    instance: "mac";
    target: {
        provider: "security";
        resource_type: string;
        uuid: string;
        name: string;
    };
    risk: string;
    kind: "remediation" | "question";
    reasoning: string;
    plan: SecurityPlan;
    urgent: boolean;
    note?: string;
}
export interface ClassifiedFinding {
    finding: Finding;
    classification: Classification;
}
/** Build one escalation from a classified finding. */
export declare function toEscalation(cf: ClassifiedFinding): SecurityEscalation;
export interface BuiltEscalations {
    escalations: SecurityEscalation[];
    /** fingerprint → plan-hash for every emitted escalation, to merge into emit-state */
    hashes: Record<string, string>;
}
/** Build the full set of escalations to POST, plus the plan-hashes to record. */
export declare function buildEscalations(items: ClassifiedFinding[], now: string): BuiltEscalations;
/** Merge freshly-emitted hashes into the existing emit-state with a timestamp. */
export declare function mergeEmitState(state: EmitState, hashes: Record<string, string>, now: string): EmitState;
/** Pick the escalations that correspond to NEW/changed findings (for the immediate email). */
export declare function newEscalations(escalations: SecurityEscalation[], diffs: DiffItem[]): SecurityEscalation[];
//# sourceMappingURL=emit.d.ts.map