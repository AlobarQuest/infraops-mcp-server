// WS-0.7 credential-rotation detection + plan building.
//
// DETECT: emits `cred.exposure-rotate` (FAIL, one-shot rotate-now until the
// exposure is recorded resolved), `cred.rotation-age` (WARN past the per-class
// max age) and `cred.rotation-requested` (WARN while a registry `rotate_requested`
// date is later than the last recorded rotation) findings, merged into the 3am
// security-drift run via extraFindings. A revoke-no-replacement credential whose
// revoke is recorded in state raises neither of the last two.
//
// PLAN: for each managed credential, builds the Classification the taxonomy hands
// back for its findings. Executor-runnable rotation plans are built ONLY when every
// fail-safe gate passes (consumer set attested, no open preconditions, every
// consumer kind supported, an old-value probe source exists, class allowed in the
// executor). Everything else falls back to a manual checklist — deny-by-default.
//
// The one invariant (spec): create → store → deploy → verify → revoke. Create is
// ALWAYS Devon at the provider console; the executor never mints and never revokes
// at a provider — its "revoke" step only CONFIRMS the old value is dead (401/403)
// and then retires the BWS copy. PG-password and BWS-machine-token classes are not
// representable as executor plans at all.
import { loadValidated0600Json, saveValidated0600Json } from './validated-store.js';
// Per-class policy (mirrors the infra-brain `cred.rotation-age` / landmine rules).
export const CLASS_POLICY = {
    'github-pat-classic': {
        maxAgeDays: 180,
        probe: 'github',
        executor: true,
        landmines: [
            'LANDMINE: deleting a GitHub PAT also deletes SSH/deploy keys that PAT created — enumerate account SSH keys (GitHub → Settings → SSH and GPG keys; API needs admin:public_key) AND repo deploy keys BEFORE revoking; re-add any load-bearing key via the web UI first.',
            "GitHub 'last used' lags — never keep/revoke by it; the replacement keeper is name-distinct.",
        ],
    },
    'github-pat-fine-grained': {
        maxAgeDays: 180,
        probe: 'github',
        executor: true,
        landmines: [
            'LANDMINE: deleting a GitHub PAT also deletes SSH/deploy keys it created — enumerate before revoking.',
        ],
    },
    'openrouter-key': { maxAgeDays: 365, probe: 'openrouter', executor: true, landmines: [] },
    'openai-key': { maxAgeDays: 365, probe: 'openai', executor: true, landmines: [] },
    // Atlassian API token (Bitbucket): Basic auth (email:token), not Bearer. The probe
    // needs probe_email + probe_workspace on the registry entry (below).
    'atlassian-api-token': { maxAgeDays: 365, probe: 'bitbucket', executor: true, landmines: [] },
    'brain-mcp-key': {
        maxAgeDays: 365,
        executor: false,
        landmines: [
            'LANDMINE: rotating a brain MCP_ACCESS_KEY re-keys its live claude.ai connector — pair the rotation with an immediate connector reconfig; never batch unattended.',
        ],
    },
    'coolify-pg-password': {
        maxAgeDays: Number.POSITIVE_INFINITY,
        executor: false,
        landmines: [
            'NEVER cycle a Coolify Postgres password in place — delete the volume and redeploy fresh (repo CLAUDE.md). Manual + Devon-driven only.',
        ],
    },
    'bws-machine-token': {
        maxAgeDays: 365,
        executor: false,
        landmines: [
            'BWS machine tokens are console-minted only — create/revoke in the Bitwarden console; never via CLI.',
        ],
    },
    // Opaque M2M bearers the orchestrator (sds.alobar.net) authenticates. Coolify holds only
    // sha256(token) per key id, so no executor consumer kind can deploy a new value.
    'orchestrator-m2m-bearer': {
        maxAgeDays: 365,
        executor: false,
        landmines: [
            'Coolify ORCHESTRATOR_M2M_CREDENTIALS holds sha256(token) per key id, never the token: replace only the hash of that entry, keep the key id and agent_id (attribution is permanent).',
            'Write ORCHESTRATOR_M2M_CREDENTIALS before ORCHESTRATOR_M2M_ROLES and verify each in the container before the next restart (roles without credentials fail boot closed); never restart while a dispatched run is live.',
        ],
    },
    // change-manager (change-mgr.alobar.net) bearers: plaintext Coolify env per scope.
    'change-manager-m2m-bearer': {
        maxAgeDays: 365,
        executor: false,
        landmines: [
            'Never give two change-manager scope variables the same value: auth._token_scopes keeps the FIRST scope for a value (read, propose, observe, full), so a shared value is silently narrowed.',
            'An unset M2M_TOKEN* grants nothing: blanking one mid-rotation 401s every consumer of that scope until the redeploy lands.',
        ],
    },
};
// Consumer kinds the executor knows how to deploy to. Anything else forces manual —
// at plan-build time here, and again in the executor's run-time guards before any write.
export const SUPPORTED_CONSUMER_KINDS = new Set([
    'bws-secret',
    'keychain',
    'coolify-env',
    'gh-actions-secret',
]);
// ── Rotation state (0600, same trust boundary as baseline/emit-state) ───────────
export class RotationStateIntegrityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RotationStateIntegrityError';
    }
}
const EMPTY_STATE = { resolvedExposures: {}, lastRotated: {} };
export function loadRotationState(file) {
    const parsed = loadValidated0600Json(file, 'rotation-state', RotationStateIntegrityError);
    if (parsed === null)
        return structuredClone(EMPTY_STATE);
    return {
        resolvedExposures: parsed.resolvedExposures ?? {},
        lastRotated: parsed.lastRotated ?? {},
    };
}
export function saveRotationState(file, state) {
    saveValidated0600Json(file, state);
}
/**
 * Record a verified rotation: set `lastRotated[credId]` to `isoDate` (normalized to
 * a full ISO timestamp). Refuses an id outside the registry, an unparseable date, and
 * a date after `now` (a future lastRotated would silence the age finding).
 * Mutates `state`; the caller persists it. Returns the previous value.
 */
export function recordRotation(state, knownIds, credId, isoDate, now) {
    if (!knownIds.has(credId))
        throw new Error(`unknown credential id '${credId}' — not in any listed .cred-consumers.toml`);
    const ms = Date.parse(isoDate);
    if (Number.isNaN(ms))
        throw new Error(`invalid date '${isoDate}' — use an ISO date or 'now'`);
    if (ms > Date.parse(now))
        throw new Error(`date '${isoDate}' is in the future`);
    const previous = state.lastRotated[credId];
    const recorded = new Date(ms).toISOString();
    state.lastRotated[credId] = recorded;
    return { previous, recorded };
}
// ── Findings ─────────────────────────────────────────────────────────────────────
export function credTarget(credId) {
    return `cred:${credId}`;
}
/** Findings for the current registry + state. Pure — no I/O. */
export function credFindings(specs, state, now) {
    const findings = [];
    const nowMs = new Date(now).getTime();
    for (const spec of specs) {
        const openExposures = spec.exposures.filter((e) => !state.resolvedExposures[`${spec.id}:${e.id}`]);
        if (openExposures.length) {
            const exp = openExposures[0];
            findings.push({
                severity: 'FAIL',
                check: 'cred.exposure-rotate',
                target: credTarget(spec.id),
                detail: `${credTarget(spec.id)} (class ${spec.class}, fp ${spec.fingerprint_sha256_8 ?? '?'}) exposed ${exp.date} via ${exp.source ?? 'recorded exposure'} — rotate now (exposure ${exp.id})`,
            });
            continue; // exposure supersedes age for the same credential
        }
        const policy = CLASS_POLICY[spec.class];
        if (!policy) {
            // A class outside CLASS_POLICY has no max age, so it would never age and nothing
            // would say so. Report it per credential; the rest of the registry still loads.
            findings.push({
                severity: 'WARN',
                check: 'cred.unknown-class',
                target: credTarget(spec.id),
                detail: `${credTarget(spec.id)} declares class '${spec.class}', which has no rotation policy — it is never aged; fix the class in its .cred-consumers.toml`,
            });
            continue;
        }
        // The executor records a revoke-no-replacement credential's confirmed revoke as
        // its lastRotated; a revoked credential has nothing left to rotate.
        if (spec.disposition === 'revoke-no-replacement' && state.lastRotated[spec.id])
            continue;
        const anchor = state.lastRotated[spec.id] ?? spec.last_rotated ?? spec.created;
        if (anchor && Number.isFinite(policy.maxAgeDays)) {
            const ageDays = (nowMs - new Date(anchor).getTime()) / 86400_000;
            if (ageDays > policy.maxAgeDays) {
                findings.push({
                    severity: 'WARN',
                    check: 'cred.rotation-age',
                    target: credTarget(spec.id),
                    detail: `${credTarget(spec.id)} (class ${spec.class}) is ${Math.floor(ageDays)}d old — class max is ${policy.maxAgeDays}d; schedule rotation`,
                });
            }
        }
        if (spec.rotate_requested) {
            const rotated = state.lastRotated[spec.id] ?? spec.last_rotated;
            if (!rotated || Date.parse(rotated) < Date.parse(spec.rotate_requested)) {
                findings.push({
                    severity: 'WARN',
                    check: 'cred.rotation-requested',
                    target: credTarget(spec.id),
                    detail: `${credTarget(spec.id)} (class ${spec.class}) has a rotation requested ${spec.rotate_requested}; last rotated ${rotated ?? 'never'} — rotate, then record-rotation`,
                });
            }
        }
    }
    return findings;
}
export const STAGING_SERVICE = 'cred-rotation';
/** Ops/Platform — where quarantine copies are created (same project as the keepers). */
const DEFAULT_BWS_PROJECT = '26ff7e3e-8769-45ff-885c-b415013b4bbf';
function manualClassification(spec, reasons, steps) {
    const policy = CLASS_POLICY[spec.class];
    return {
        tier: 'URGENT',
        kind: 'question',
        risk: 'caution',
        remediation: {
            manual: [
                ...(policy?.landmines ?? []),
                ...reasons.map((r) => `NOT executor-eligible: ${r}`),
                ...steps,
            ],
        },
        title: `Rotate ${spec.id} (${spec.class}) — manual`,
    };
}
function consoleSteps(spec) {
    const steps = [];
    if (spec.disposition === 'reissue' || spec.disposition === 'reissue-least-privilege') {
        steps.push(`1. CREATE (Devon): mint the replacement at the provider (${spec.provider_identity ?? spec.provider ?? spec.class})` +
            (spec.replacement_scope ? ` — scope: ${spec.replacement_scope}` : '') +
            `; name it distinctly (keeper-naming discipline).`, `2. STAGE (Devon, real Terminal): security add-generic-password -U -s ${STAGING_SERVICE} -a ${spec.id} -T /usr/bin/security -w`, `3. Approve this item — the executor then stores (quarantines old + updates BWS ${spec.bws_uuid ?? '?'} in place), deploys to all mapped consumers, and verifies the new credential + consumers.`, `4. REVOKE (Devon): once the window reports verify green, revoke the OLD credential at the provider console, then re-approve; the executor confirms the old value is dead (401) before retiring the quarantine copy and closing the exposure.`);
    }
    else {
        steps.push(`1. REVOKE (Devon): revoke the credential at the provider console (${spec.provider_identity ?? spec.provider ?? spec.class}). No replacement needed — mapped consumer set is storage-only/empty.`, `2. Re-approve this item — the executor confirms the old value is dead (401), retires the BWS copy, verifies the current keeper still authenticates, and closes the exposure.`);
    }
    return steps;
}
/**
 * Build the Classification for every managed credential's findings, keyed by
 * `${check}|${target}` (the lookup the taxonomy uses for cred.* checks).
 */
export function buildCredClassifications(specs, state) {
    const out = {};
    for (const spec of specs) {
        const target = credTarget(spec.id);
        const rotate = rotationClassification(spec, state);
        out[`cred.exposure-rotate|${target}`] = rotate;
        out[`cred.rotation-age|${target}`] = {
            ...rotate,
            tier: 'NORMAL',
            title: `Rotation due: ${spec.id} (${spec.class})`,
        };
        out[`cred.rotation-requested|${target}`] = {
            ...rotate,
            tier: 'NORMAL',
            title: `Rotation requested: ${spec.id} (${spec.class})`,
        };
        out[`cred.unknown-class|${target}`] = {
            tier: 'NORMAL',
            kind: 'question',
            risk: 'caution',
            remediation: {
                manual: [
                    `Set ${spec.id}'s class to one defined in CLASS_POLICY (src/security-drift/cred-rotation.ts), or add the class there with executor:false.`,
                ],
            },
            title: `Unknown credential class: ${spec.id} (${spec.class})`,
        };
    }
    return out;
}
function rotationClassification(spec, state) {
    const policy = CLASS_POLICY[spec.class];
    const steps = consoleSteps(spec);
    const blockers = [];
    if (!policy)
        blockers.push(`unknown credential class '${spec.class}'`);
    else if (!policy.executor)
        blockers.push(`class ${spec.class} is never executor-run (manual lane)`);
    if (!spec.consumers_verified)
        blockers.push('consumer set not attested (consumers_verified missing) — FAIL-SAFE: never revoke an unmapped credential');
    for (const pre of spec.rotation_preconditions)
        blockers.push(`open precondition: ${pre}`);
    const unsupported = spec.consumers.filter((c) => !SUPPORTED_CONSUMER_KINDS.has(c.kind));
    for (const c of unsupported)
        blockers.push(`consumer kind '${c.kind}' not supported by the executor`);
    if (!spec.bws_uuid)
        blockers.push('no BWS copy of the old value — executor cannot confirm provider revoke (401 probe)');
    if (policy && !policy.probe)
        blockers.push(`class ${spec.class} has no provider probe`);
    // The bitbucket probe is Basic auth (email:token) against /repositories/{workspace};
    // both are non-secret and required, else verify-before-revoke can't run.
    if (policy?.probe === 'bitbucket' && (!spec.probe_email || !spec.probe_workspace)) {
        blockers.push('bitbucket probe requires probe_email + probe_workspace on the registry entry');
    }
    if (blockers.length)
        return manualClassification(spec, blockers, steps);
    const reissue = spec.disposition === 'reissue' || spec.disposition === 'reissue-least-privilege';
    const openExposures = spec.exposures
        .filter((e) => !state.resolvedExposures[`${spec.id}:${e.id}`])
        .map((e) => e.id);
    const plan = {
        credId: spec.id,
        credClass: spec.class,
        fingerprint8: spec.fingerprint_sha256_8,
        consumersVerified: spec.consumers_verified,
        retireBwsUuids: reissue ? [] : [spec.bws_uuid],
        consumers: spec.consumers,
        providerProbe: policy.probe,
        ...(spec.probe_email ? { probeEmail: spec.probe_email } : {}),
        ...(spec.probe_workspace ? { probeWorkspace: spec.probe_workspace } : {}),
        exposureIds: openExposures,
        manualSteps: [...policy.landmines, ...steps],
        ...(reissue
            ? {
                staging: { service: STAGING_SERVICE, account: spec.id },
                keeperBwsUuid: spec.bws_uuid,
                quarantineName: `${spec.id}-pre-rotation-quarantine`,
                bwsProjectId: DEFAULT_BWS_PROJECT,
            }
            : {}),
    };
    const remediation = { rotation: plan };
    return {
        tier: 'URGENT',
        kind: 'remediation',
        risk: 'caution',
        remediation,
        title: `Rotate ${spec.id} (${spec.class}) — executor-assisted`,
    };
}
//# sourceMappingURL=cred-rotation.js.map