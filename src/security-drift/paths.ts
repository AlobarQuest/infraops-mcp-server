// Single source of truth for security-drift state file locations, so the runner
// (writer) and the 4am executor (reader) always agree on the emit-state path the
// integrity gate depends on.

import * as os from "node:os";
import * as path from "node:path";

export interface SecurityPaths {
  cfgDir: string;
  stateDir: string;
  scanPath: string;
  baselineFile: string;
  emitStateFile: string;
  rollbackLog: string;
  autoFixAllowlistFile: string;
  fpAllowlistFile: string;
}

export function securityPaths(): SecurityPaths {
  const home = os.homedir();
  const cfgDir = process.env.INFRADRIFT_CONFIG_DIR ?? path.join(home, ".config", "infra-drift");
  const stateDir = process.env.SECURITY_DRIFT_STATE_DIR ?? cfgDir;
  return {
    cfgDir,
    stateDir,
    scanPath: process.env.SECURITY_SCAN_PATH ?? path.join(home, ".claude", "bin", "security-scan.sh"),
    baselineFile: path.join(stateDir, "security-baseline.json"),
    emitStateFile: path.join(stateDir, "security-emit-state.json"),
    rollbackLog: path.join(stateDir, "security-rollback.jsonl"),
    autoFixAllowlistFile: path.join(cfgDir, "security-autofix-allowlist.txt"),
    fpAllowlistFile: path.join(cfgDir, "security-fp-allowlist.txt"),
  };
}
