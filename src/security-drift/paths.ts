// Single source of truth for security-drift state file locations, so the runner
// (writer) and the 4am executor (reader) always agree on the emit-state path the
// integrity gate depends on.

import * as os from "node:os";
import * as path from "node:path";

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
  /** newline-delimited list of .cred-consumers.toml paths (WS-0.7 rotation registry) */
  credConsumersList: string;
  credRotationStateFile: string;
}

export function securityPaths(): SecurityPaths {
  const home = os.homedir();
  const cfgDir = process.env.INFRADRIFT_CONFIG_DIR ?? path.join(home, ".config", "infra-drift");
  const stateDir = process.env.SECURITY_DRIFT_STATE_DIR ?? cfgDir;
  const autoFixAllowlistFile = path.join(cfgDir, "security-autofix-allowlist.txt");
  const fpAllowlistFile = path.join(cfgDir, "security-fp-allowlist.txt");
  return {
    cfgDir,
    stateDir,
    scanPath: process.env.SECURITY_SCAN_PATH ?? path.join(home, ".claude", "bin", "security-scan.sh"),
    scanSourcePath: process.env.SECURITY_SCAN_SOURCE_PATH ?? path.join(home, "Projects", "security-standards", "scripts", "security-scan.sh"),
    baselineFile: path.join(stateDir, "security-baseline.json"),
    emitStateFile: path.join(stateDir, "security-emit-state.json"),
    rollbackLog: path.join(stateDir, "security-rollback.jsonl"),
    autoFixAllowlistFile,
    fpAllowlistFile,
    auditLog: process.env.SECURITY_AUDIT_LOG ?? path.join(home, ".claude", "audit", "high-power-actions.jsonl"),
    hwmFile: path.join(stateDir, "security-auditlog-hwm.json"),
    hashFile: path.join(stateDir, "security-runner-hashes.json"),
    credConsumersList: path.join(cfgDir, "cred-consumers.list"),
    credRotationStateFile: path.join(stateDir, "cred-rotation-state.json"),
  };
}
