// Narrow, guarded, reversible chmod-600 auto-fixer. Deny-by-default.
//
// This is the ONLY automated security mutation. Per the post-debate taxonomy it is
// hardened against the ways `chmod` can be weaponized:
//   - symlink poisoning  → open with O_NOFOLLOW (ELOOP on a symlink)
//   - hardlink aliasing  → require nlink === 1
//   - wrong owner        → require st.uid === current user
//   - writable parent dir→ require parent not other-writable
//   - TOCTOU             → fchmod on the OPEN fd (the inode), never on the path
//   - planted-file DoS   → per-run cap; excess → blocked → URGENT
// A rollback record is written BEFORE mutating. Any failed precondition returns
// `blocked` (the runner re-tiers it to URGENT — AUTO-FIX-BLOCKED), never acting.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface AutoFixOptions {
  /** explicit path allowlist — empty ⇒ nothing is auto-fixed */
  allowlist: string[];
  /** 0600 append-only rollback record path */
  rollbackLog: string;
  /** override for tests; defaults to process.getuid */
  getUid?: () => number;
}

export type AutoFixResult =
  | { status: "applied"; target: string; priorMode: number }
  | { status: "blocked"; target: string; reason: string };

function currentUid(opts: AutoFixOptions): number | null {
  if (opts.getUid) return opts.getUid();
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function appendRollback(rollbackLog: string, rec: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(rollbackLog), { recursive: true });
  // O_APPEND|O_CREAT with 0600; ensure mode even if it pre-existed.
  const fd = fs.openSync(rollbackLog, "a", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(rec) + "\n");
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(rollbackLog, 0o600);
}

/** Attempt to chmod 600 a single allowlisted target with all guards. Never throws. */
export function autoFix(target: string, opts: AutoFixOptions): AutoFixResult {
  if (!opts.allowlist.includes(target)) {
    return { status: "blocked", target, reason: "not on auto-fix allowlist" };
  }

  let fd: number;
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (e: any) {
    if (e?.code === "ELOOP") return { status: "blocked", target, reason: "target is a symlink (O_NOFOLLOW)" };
    return { status: "blocked", target, reason: `open failed: ${e?.code ?? e?.message ?? "unknown"}` };
  }

  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { status: "blocked", target, reason: "not a regular file" };
    if (st.nlink !== 1) return { status: "blocked", target, reason: `hardlinked (nlink=${st.nlink})` };
    const uid = currentUid(opts);
    if (uid !== null && st.uid !== uid) return { status: "blocked", target, reason: `owner uid ${st.uid} != ${uid}` };

    const parentMode = fs.lstatSync(path.dirname(target)).mode & 0o777;
    if ((parentMode & 0o002) !== 0) return { status: "blocked", target, reason: `parent dir other-writable (${parentMode.toString(8)})` };

    const priorMode = st.mode & 0o777;
    if (priorMode === 0o600) return { status: "blocked", target, reason: "already 600 (nothing to fix)" };

    // rollback record FIRST (path, inode, prior mode/owner, content hash, ts) — never the secret value
    const contentHash = createHash("sha256").update(fs.readFileSync(fd)).digest("hex");
    appendRollback(opts.rollbackLog, {
      path: target, ino: st.ino, priorMode, uid: st.uid, gid: st.gid, sha256: contentHash, ts: new Date().toISOString(),
    });

    fs.fchmodSync(fd, 0o600); // on the fd = the inode → TOCTOU-safe
    return { status: "applied", target, priorMode };
  } catch (e: any) {
    return { status: "blocked", target, reason: `guard/chmod failed: ${e?.code ?? e?.message ?? "unknown"}` };
  } finally {
    fs.closeSync(fd);
  }
}

export interface RunAutoFixOptions extends AutoFixOptions {
  /** max auto-actions per run; excess targets are blocked (planted-file DoS defense) */
  cap: number;
}
export interface AutoFixRun {
  applied: { target: string; priorMode: number }[];
  blocked: { target: string; reason: string }[];
}

/** Apply auto-fixes across many targets, enforcing the per-run cap. */
export function runAutoFixes(targets: string[], opts: RunAutoFixOptions): AutoFixRun {
  const run: AutoFixRun = { applied: [], blocked: [] };
  for (const target of targets) {
    if (run.applied.length >= opts.cap) {
      run.blocked.push({ target, reason: `auto-fix cap (${opts.cap}) reached` });
      continue;
    }
    const r = autoFix(target, opts);
    if (r.status === "applied") run.applied.push({ target: r.target, priorMode: r.priorMode });
    else run.blocked.push({ target: r.target, reason: r.reason });
  }
  return run;
}
