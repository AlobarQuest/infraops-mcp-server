export interface SyncBody {
    generated_at: string;
    source_report: string;
    escalations: unknown[];
}
export interface SyncSummary {
    new: number;
    refreshed: number;
    resolved: number;
    reopened: number;
}
export interface ApprovedItem {
    id: number;
    identity: string;
    instance: string;
    rule_key: string;
    resource_type: string | null;
    resource_uuid: string;
    resource_name: string;
    risk: string;
    kind: string;
    reasoning: string;
    plan: Record<string, unknown>;
    note: string | null;
    status: string;
}
export interface OutcomeBody {
    outcome: "done" | "failed" | "blocked" | "skipped_conformant";
    detail?: string;
    tool_calls?: Record<string, unknown>;
    rollback?: Record<string, unknown>;
}
export declare class ChangeMgrClient {
    private base;
    private token;
    constructor(base: string, token: string);
    private req;
    postSync(body: SyncBody): Promise<SyncSummary>;
    getApproved(): Promise<ApprovedItem[]>;
    claim(id: number): Promise<ApprovedItem>;
    postOutcome(id: number, body: OutcomeBody): Promise<unknown>;
    startWindow(startedAt: string): Promise<{
        id: number;
    }>;
    finishWindow(id: number, counts: Record<string, unknown>): Promise<unknown>;
}
//# sourceMappingURL=api-client.d.ts.map