export type Op = "eq" | "neq" | "contains" | "not_contains" | "present" | "absent" | "empty" | "non_empty" | "starts_with" | "not_starts_with" | "matches";
export interface Assertion {
    field: string;
    op: Op;
    value?: unknown;
}
export interface StandardCheck {
    rule_id: number;
    rule_text: string;
    severity: "BLOCK" | "WARN" | "INFO";
    schema_version: number;
    resource: "coolify_application" | "coolify_database";
    assert: Assertion;
    when?: Assertion;
    remediation_key?: string;
    kind: "remediation" | "question";
}
export type Risk = "safe" | "caution" | "destructive";
export type Confidence = "high" | "medium" | "low";
export interface PlannedAction {
    tool: string;
    args: Record<string, unknown>;
}
export interface Proposal {
    id: string;
    kind: "remediation" | "question";
    source: "standards-audit";
    status: "pending";
    target: {
        provider: "coolify";
        resource_type: string;
        uuid: string;
        name: string;
    };
    description: string;
    reasoning: string;
    confidence: Confidence;
    risk: Risk;
    planned_action: PlannedAction | null;
    question: string | null;
}
export declare function evaluateCheck(check: StandardCheck, resource: Record<string, unknown>, resolveRemediation: (key: string, res: Record<string, unknown>) => {
    action: PlannedAction;
    risk: Risk;
} | null): Proposal | null;
//# sourceMappingURL=check-engine.d.ts.map