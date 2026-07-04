// Local-artifact control-plane self-check. The fixer protecting itself: it emits
// URGENT findings (fed into the same pipeline) when its own trust boundaries look
// tampered. (The DEEP check of the *deployed* change-manager on Coolify is fast-follow.)
//
// Checks:
//   1. state-file perms — baseline / emit-state / rollback must be 0600 + owned by us
//   2. audit-log tamper — high-power-actions.jsonl must never SHRINK (append-only)
//   3a. source integrity — deployed scanner must byte-match its blessed source
//   3b. change integrity — allowlist config files must not change unexpectedly
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
function uidOf(cfg) {
    if (cfg.getUid)
        return cfg.getUid();
    return typeof process.getuid === 'function' ? process.getuid() : null;
}
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
function writeJson(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
}
const fail = (check, target, detail) => ({
    severity: 'FAIL',
    check,
    target,
    detail,
});
export function runSelfCheck(cfg) {
    const findings = [];
    const uid = uidOf(cfg);
    // 1. state-file permissions
    for (const file of cfg.stateFiles) {
        let st;
        try {
            st = fs.lstatSync(file);
        }
        catch {
            continue; // not yet created — nothing to check
        }
        const mode = st.mode & 0o777;
        if (mode !== 0o600 || (uid !== null && st.uid !== uid)) {
            findings.push(fail('selfcheck.state_perms', file, `state file mode ${mode.toString(8)} owner ${st.uid} (expected 600 / uid ${uid})`));
        }
    }
    // 2. audit-log must not shrink (append-only)
    try {
        const size = fs.statSync(cfg.auditLog).size;
        const hwm = readJson(cfg.hwmFile);
        if (hwm && size < hwm.size) {
            findings.push(fail('auditlog.tampered', cfg.auditLog, `audit log shrank from ${hwm.size} to ${size} bytes (append-only invariant violated)`));
        }
        writeJson(cfg.hwmFile, { size: Math.max(size, hwm?.size ?? 0), ts: cfg.now });
    }
    catch {
        // audit log absent → skip (not all machines have one yet)
    }
    // 3a. source-verified integrity — a deployed artifact must byte-match its blessed
    // source-of-truth. Stateless (no hash store): the steady state right after a legit
    // `make install` (shutil.copyfile) is deployed == source. A mismatch means tamper or a
    // stale/forgotten deploy; an unreadable source means we cannot verify — emit, never
    // silently pass (deny-by-default).
    for (const { deployed, source } of cfg.sourceVerifiedFiles) {
        let deployedBuf;
        try {
            deployedBuf = fs.readFileSync(deployed);
        }
        catch (e) {
            if (e?.code === 'ENOENT')
                continue; // not deployed yet — nothing to verify
            // present but unreadable (bad perms, etc.) — fail loud, don't silently skip
            findings.push(fail('selfcheck.runner_source_unresolved', deployed, `deployed scanner present but unreadable (${e?.code ?? 'read error'}) — cannot verify`));
            continue;
        }
        let sourceBuf;
        try {
            sourceBuf = fs.readFileSync(source);
        }
        catch {
            findings.push(fail('selfcheck.runner_source_unresolved', deployed, `blessed source unreadable at ${source} — cannot verify deployed artifact`));
            continue;
        }
        if (!deployedBuf.equals(sourceBuf)) {
            findings.push(fail('selfcheck.runner_integrity', deployed, `deployed scanner does not match blessed source ${source} — investigate tamper or stale deploy`));
        }
    }
    // 3b. change-tracked integrity (config files with no source-of-truth repo)
    const recorded = readJson(cfg.hashFile) ?? {};
    const next = { ...recorded };
    for (const file of cfg.integrityFiles) {
        let buf;
        try {
            buf = fs.readFileSync(file);
        }
        catch {
            continue;
        }
        const h = createHash('sha256').update(buf).digest('hex');
        if (recorded[file] && recorded[file] !== h) {
            findings.push(fail('selfcheck.runner_integrity', file, 'scanner/config file hash changed since last run — verify this change was intentional'));
        }
        next[file] = h;
    }
    writeJson(cfg.hashFile, next);
    return findings;
}
//# sourceMappingURL=self-check.js.map