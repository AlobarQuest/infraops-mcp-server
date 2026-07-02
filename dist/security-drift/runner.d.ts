import type { SyncBody, SyncSummary } from "../change-manager/api-client.js";
import { type SecurityEscalation } from "./emit.js";
export interface RunnerConfig {
    scanStdout: string;
    now: string;
    autoFixAllowlist: string[];
    fpExtra?: string[];
    baselineFile: string;
    emitStateFile: string;
    rollbackLog: string;
    autoFixCap: number;
    emitStateMaxAgeDays?: number;
    /** extra findings to merge with the scan output (e.g. control-plane self-check) */
    extraFindings?: import("./scan-parser.js").Finding[];
    /** pre-built cred.* classifications (WS-0.7), keyed `${check}|${target}` */
    credClassifications?: Record<string, import("./taxonomy.js").Classification>;
}
export interface RunnerDeps {
    postSync: (body: SyncBody) => Promise<SyncSummary>;
    sendUrgent: (items: SecurityEscalation[]) => Promise<boolean>;
}
export interface RunnerResult {
    seeded: boolean;
    autoFixed: {
        target: string;
        priorMode: number;
    }[];
    autoFixBlocked: {
        target: string;
        reason: string;
    }[];
    emitted: number;
    urgent: number;
    urgentEmailed: number;
    digest: string;
}
export declare function runSecurityDrift(config: RunnerConfig, deps: RunnerDeps): Promise<RunnerResult>;
//# sourceMappingURL=runner.d.ts.map