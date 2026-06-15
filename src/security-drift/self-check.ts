// Local-artifact control-plane self-check. The fixer protecting itself: it emits
// URGENT findings (fed into the same pipeline) when its own trust boundaries look
// tampered. (The DEEP check of the *deployed* change-manager on Coolify is fast-follow.)
//
// Checks:
//   1. state-file perms — baseline / emit-state / rollback must be 0600 + owned by us
//   2. audit-log tamper — high-power-actions.jsonl must never SHRINK (append-only)
//   3. runner integrity — security-scan.sh + allowlist files must not change unexpectedly

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding } from "./scan-parser.js";

export interface SelfCheckConfig {
  stateFiles: string[]; // must be 0600 + owned
  auditLog: string;
  hwmFile: string; // 0600 store of the audit-log high-water size
  integrityFiles: string[]; // hashed for change detection
  hashFile: string; // 0600 store of recorded hashes
  now: string;
  getUid?: () => number;
}

function uidOf(cfg: SelfCheckConfig): number | null {
  if (cfg.getUid) return cfg.getUid();
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

const fail = (check: string, target: string, detail: string): Finding => ({ severity: "FAIL", check, target, detail });

export function runSelfCheck(cfg: SelfCheckConfig): Finding[] {
  const findings: Finding[] = [];
  const uid = uidOf(cfg);

  // 1. state-file permissions
  for (const file of cfg.stateFiles) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(file);
    } catch {
      continue; // not yet created — nothing to check
    }
    const mode = st.mode & 0o777;
    if (mode !== 0o600 || (uid !== null && st.uid !== uid)) {
      findings.push(fail("selfcheck.state_perms", file, `state file mode ${mode.toString(8)} owner ${st.uid} (expected 600 / uid ${uid})`));
    }
  }

  // 2. audit-log must not shrink (append-only)
  try {
    const size = fs.statSync(cfg.auditLog).size;
    const hwm = readJson<{ size: number }>(cfg.hwmFile);
    if (hwm && size < hwm.size) {
      findings.push(fail("auditlog.tampered", cfg.auditLog, `audit log shrank from ${hwm.size} to ${size} bytes (append-only invariant violated)`));
    }
    writeJson(cfg.hwmFile, { size: Math.max(size, hwm?.size ?? 0), ts: cfg.now });
  } catch {
    // audit log absent → skip (not all machines have one yet)
  }

  // 3. runner / config integrity
  const recorded = readJson<Record<string, string>>(cfg.hashFile) ?? {};
  const next: Record<string, string> = { ...recorded };
  for (const file of cfg.integrityFiles) {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }
    const h = createHash("sha256").update(buf).digest("hex");
    if (recorded[file] && recorded[file] !== h) {
      findings.push(fail("selfcheck.runner_integrity", file, "scanner/config file hash changed since last run — verify this change was intentional"));
    }
    next[file] = h;
  }
  writeJson(cfg.hashFile, next);

  return findings;
}
