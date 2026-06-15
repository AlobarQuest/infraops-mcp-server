import type { Finding } from "./scan-parser.js";
export interface SelfCheckConfig {
    stateFiles: string[];
    auditLog: string;
    hwmFile: string;
    integrityFiles: string[];
    hashFile: string;
    now: string;
    getUid?: () => number;
}
export declare function runSelfCheck(cfg: SelfCheckConfig): Finding[];
//# sourceMappingURL=self-check.d.ts.map