// The accepted-baseline store + the new/changed diff.
//
// SECURITY (trust boundary): the baseline file is an attacker target — if writable,
// an adversary could suppress a real finding or inject an "accepted" state. So the
// file is mode 0600, owned by the runner user, and validated on every read. A
// failed validation throws BaselineIntegrityError (the runner turns that into an
// URGENT control-plane finding rather than trusting a poisoned diff).
import { createHash } from "node:crypto";
import { loadValidated0600Json, saveValidated0600Json } from "./validated-store.js";
export class BaselineIntegrityError extends Error {
    constructor(message) {
        super(message);
        this.name = "BaselineIntegrityError";
    }
}
/** Stable cross-run fingerprint for a finding. */
export function fingerprint(check, target) {
    return createHash("sha256").update(check).update("\0").update(target).digest("hex");
}
/**
 * Load and validate the baseline. A missing file means "first run" → returns null so
 * the caller can SEED rather than treat every current finding as new drift.
 * A present file MUST be a regular file, mode 0600, owned by the current user.
 */
export function loadBaseline(file) {
    return loadValidated0600Json(file, "baseline", BaselineIntegrityError);
}
/** Atomically write the baseline with mode 0600. */
export function saveBaseline(file, baseline) {
    saveValidated0600Json(file, baseline);
}
/**
 * Return findings that are NEW (not in baseline) or CHANGED (tier differs).
 * Suppresses findings whose fingerprint is in the baseline with the same tier.
 */
export function diffFindings(classified, baseline) {
    const out = [];
    for (const { finding, classification } of classified) {
        const fp = fingerprint(finding.check, finding.target);
        const prev = baseline[fp];
        if (!prev || prev.tier !== classification.tier) {
            out.push({ fingerprint: fp, finding, classification });
        }
    }
    return out;
}
/** Build a fresh baseline snapshot from the current classified findings. */
export function snapshot(classified, now, prev = {}) {
    const next = {};
    for (const { finding, classification } of classified) {
        const fp = fingerprint(finding.check, finding.target);
        next[fp] = { firstSeen: prev[fp]?.firstSeen ?? now, tier: classification.tier };
    }
    return next;
}
//# sourceMappingURL=baseline.js.map