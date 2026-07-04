export interface AutoFixOptions {
    /** explicit path allowlist — empty ⇒ nothing is auto-fixed */
    allowlist: string[];
    /** 0600 append-only rollback record path */
    rollbackLog: string;
    /** override for tests; defaults to process.getuid */
    getUid?: () => number;
}
export type AutoFixResult = {
    status: 'applied';
    target: string;
    priorMode: number;
} | {
    status: 'blocked';
    target: string;
    reason: string;
};
/** Attempt to chmod 600 a single allowlisted target with all guards. Never throws. */
export declare function autoFix(target: string, opts: AutoFixOptions): AutoFixResult;
export interface RunAutoFixOptions extends AutoFixOptions {
    /** max auto-actions per run; excess targets are blocked (planted-file DoS defense) */
    cap: number;
}
export interface AutoFixRun {
    applied: {
        target: string;
        priorMode: number;
    }[];
    blocked: {
        target: string;
        reason: string;
    }[];
}
/** Apply auto-fixes across many targets, enforcing the per-run cap. */
export declare function runAutoFixes(targets: string[], opts: RunAutoFixOptions): AutoFixRun;
//# sourceMappingURL=autofix.d.ts.map