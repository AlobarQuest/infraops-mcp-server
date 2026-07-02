import type { ApprovedItem, OutcomeBody } from "../change-manager/api-client.js";
import { type RotationDeps } from "./rotation-executor.js";
export interface ExecResult {
    ok: boolean;
    detail: string;
}
export interface SecurityWindowDeps {
    getApprovedSecurity: () => Promise<ApprovedItem[]>;
    claim: (id: number) => Promise<void>;
    postOutcome: (id: number, body: OutcomeBody) => Promise<void>;
    /** fired on a plan-hash mismatch / missing hash (possible tamper) */
    onIntegrityFailure: (item: ApprovedItem, reason: string) => Promise<void>;
    emitStateFile: string;
    maxChanges: number;
    /** injectable for tests; defaults to execFileSync (shell:false) */
    exec?: (cmd: string[]) => ExecResult;
    /** deps for `{ rotation }` remediations (WS-0.7). Absent ⇒ rotation items are blocked. */
    rotation?: RotationDeps;
    timeoutMs?: number;
}
export interface SecurityWindowSummary {
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
export declare function runSecurityWindow(deps: SecurityWindowDeps): Promise<SecurityWindowSummary>;
//# sourceMappingURL=security-executor.d.ts.map