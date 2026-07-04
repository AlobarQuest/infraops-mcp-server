// Maps classified findings to change-manager security escalations, and records the
// plan-hash (keyed by fingerprint) for the 4am integrity gate.
//
// Security escalations POST directly to /api/sync as opaque JSON (the web app stores
// `plan` as a JSON object), so the plan shape here is free to carry an exact
// remediation (exec | manual) without going through the strict drift-contract zod
// types. proposal_id is crafted so the web app's rule_key_of() (split on ":") yields
// a clean "sec.<check>" rule key (see change-manager app/identity.py).
import { fingerprint } from './baseline.js';
import { planHash } from './canonical.js';
const BLIND_SPOTS = 'File-scan does NOT cover secrets in env vars (ps/proc) or secrets surviving in git history — ' +
    'a clean working tree never means a leaked secret is gone; rotation is still required.';
/** Build one escalation from a classified finding. */
export function toEscalation(cf) {
    const { finding, classification } = cf;
    const fp = fingerprint(finding.check, finding.target);
    const plan = {
        generated_by: 'security-scan',
        tier: classification.tier,
        root_cause: finding.detail,
        remediation: classification.remediation,
        rollback: 'exec' in classification.remediation
            ? 'Prior file mode/owner recorded in the security-drift rollback log; restore from there.'
            : 'rotation' in classification.remediation
                ? 'Old credential value stays quarantined in BWS until it provably probes dead (401); to roll back before revoke, re-deploy the quarantined value to the mapped consumers. After revoke there is no rollback — mint a fresh credential.'
                : 'n/a — manual remediation (human applies and verifies).',
        source: 'security',
        blind_spots: BLIND_SPOTS,
    };
    return {
        proposal_id: `sec.${finding.check}:${fp.slice(0, 12)}`,
        instance: 'mac',
        target: {
            provider: 'security',
            resource_type: finding.check.split('.')[0],
            uuid: fp,
            name: classification.title,
        },
        risk: classification.risk,
        kind: classification.kind,
        reasoning: `[${classification.tier}] ${finding.check} — ${finding.detail}`,
        plan,
        urgent: classification.tier === 'URGENT',
    };
}
/** Build the full set of escalations to POST, plus the plan-hashes to record. */
export function buildEscalations(items, _now) {
    const escalations = [];
    const hashes = {};
    for (const cf of items) {
        const esc = toEscalation(cf);
        escalations.push(esc);
        hashes[esc.target.uuid] = planHash(esc.plan);
    }
    return { escalations, hashes };
}
/** Merge freshly-emitted hashes into the existing emit-state with a timestamp. */
export function mergeEmitState(state, hashes, now) {
    const next = { ...state };
    for (const [fp, hash] of Object.entries(hashes))
        next[fp] = { hash, ts: now };
    return next;
}
/** Pick the escalations that correspond to NEW/changed findings (for the immediate email). */
export function newEscalations(escalations, diffs) {
    const newFps = new Set(diffs.map((d) => d.fingerprint));
    return escalations.filter((e) => newFps.has(e.target.uuid));
}
//# sourceMappingURL=emit.js.map