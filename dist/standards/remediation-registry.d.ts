import type { PlannedAction, Risk } from "./check-engine.js";
interface Remediation {
    tool: string;
    risk: Risk;
    buildArgs: (res: Record<string, unknown>) => Record<string, unknown>;
}
export declare const REMEDIATIONS: Record<string, Remediation>;
export declare function resolveRemediation(key: string, res: Record<string, unknown>): {
    action: PlannedAction;
    risk: Risk;
} | null;
export {};
//# sourceMappingURL=remediation-registry.d.ts.map