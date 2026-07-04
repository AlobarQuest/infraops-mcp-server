import type { PlannedAction, Risk } from './check-engine.js';
/** Which lane owns the fix. Extension seam: future remediations can declare their lane here. */
export type Lane = 'infra-config' | 'app-conformance';
interface Remediation {
    tool: string;
    risk: Risk;
    /** Baseline lane for escalations of this remediation. Default infra-config. v1 leaves the
     * health-check entry at default; its app-conformance handoffs are classified dynamically by
     * the probe-guard (see handoff-brief.ts), since only the probe knows a path-mismatch from a timeout. */
    lane?: Lane;
    buildArgs: (res: Record<string, unknown>) => Record<string, unknown>;
}
export declare const REMEDIATIONS: Record<string, Remediation>;
/** The declared lane for a remediation key, defaulting to infra-config. */
export declare function laneFor(key: string): Lane;
export declare function resolveRemediation(key: string, res: Record<string, unknown>): {
    action: PlannedAction;
    risk: Risk;
} | null;
export {};
//# sourceMappingURL=remediation-registry.d.ts.map