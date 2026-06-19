export interface SecurityPaths {
    cfgDir: string;
    stateDir: string;
    scanPath: string;
    scanSourcePath: string;
    baselineFile: string;
    emitStateFile: string;
    rollbackLog: string;
    autoFixAllowlistFile: string;
    fpAllowlistFile: string;
    auditLog: string;
    hwmFile: string;
    hashFile: string;
}
export declare function securityPaths(): SecurityPaths;
//# sourceMappingURL=paths.d.ts.map