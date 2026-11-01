// WS-0.7 credential-rotation detection + plan building.
//
// DETECT: emits `cred.exposure-rotate` (FAIL, one-shot rotate-now until the
// exposure is recorded resolved), `cred.rotation-age` (WARN past the per-class
// max age) and `cred.rotation-requested` (WARN while a registry `rotate_requested`
// date is later than the last recorded rotation) findings, merged into the 3am
// security-drift run via extraFindings. A revoke-no-replacement credential whose
// revoke is recorded in state raises neither of the last two. A malformed
// rotate_requested raises `cred.invalid-rotate-requested` for that credential only.
//
// PLAN: for each managed credential, builds the Classification the taxonomy hands
// back for its findings: a manual checklist. Nothing here executes a rotation; the
// orchestrator's rotation service does that for a credential marked `rotated_by_sds`,
// and the scan never offers a plan for one of those.
//
// The one invariant (spec): create → store → deploy → verify → revoke. Create is
// ALWAYS Devon at the provider console.

import { loadValidated0600Json, saveValidated0600Json } from './validated-store.js';
import type { Finding } from './scan-parser.js';
import type { Classification } from './taxonomy.js';
import { parseIsoDay, type CredentialSpec } from './cred-consumers.js';

interface ClassPolicy {
  maxAgeDays: number;
  /** class-specific landmine steps prepended to every manual checklist */
  landmines: string[];
}

// Per-class policy (mirrors the infra-brain `cred.rotation-age` / landmine rules).
export const CLASS_POLICY: Record<string, ClassPolicy> = {
  'github-pat-classic': {
    maxAgeDays: 180,
    landmines: [
      'LANDMINE: deleting a GitHub PAT also deletes SSH/deploy keys that PAT created — enumerate account SSH keys (GitHub → Settings → SSH and GPG keys; API needs admin:public_key) AND repo deploy keys BEFORE revoking; re-add any load-bearing key via the web UI first.',
      "GitHub 'last used' lags — never keep/revoke by it; the replacement keeper is name-distinct.",
    ],
  },
  'github-pat-fine-grained': {
    maxAgeDays: 180,
    landmines: [
      'LANDMINE: deleting a GitHub PAT also deletes SSH/deploy keys it created — enumerate before revoking.',
    ],
  },
  'openrouter-key': { maxAgeDays: 365, landmines: [] },
  'openai-key': { maxAgeDays: 365, landmines: [] },
  'atlassian-api-token': { maxAgeDays: 365, landmines: [] },
  // Anthropic API key (fork-sync lane: ANTHROPIC_API_KEY Actions secrets in the forks).
  'anthropic-api-key': { maxAgeDays: 365, landmines: [] },
  'porkbun-api-key': { maxAgeDays: 365, landmines: [] },
  // A GitHub App's private key (the fork-sync lane's APP_PRIVATE_KEY Actions secrets).
  'github-app-private-key': {
    maxAgeDays: 365,
    landmines: [
      "A GitHub App can hold several key pairs; generating a new one does not revoke the old. After re-setting every copy, delete the old key pair on the App's Credentials page (Key pairs tab).",
    ],
  },
  'brain-mcp-key': {
    maxAgeDays: 365,
    landmines: [
      'LANDMINE: rotating a brain MCP_ACCESS_KEY re-keys its live claude.ai connector — pair the rotation with an immediate connector reconfig; never batch unattended.',
    ],
  },
  // A Postgres role password the orchestrator's rotation executor rotates (ADR-0055 amendment 17).
  // Never due by age: a rotation restarts the service, so only an exposure or rotate_requested asks.
  'postgres-role-password': {
    maxAgeDays: Number.POSITIVE_INFINITY,
    landmines: [
      'Rotate through the SDS: a role has one password, so the service restarts with no overlap.',
    ],
  },
  'coolify-pg-password': {
    maxAgeDays: Number.POSITIVE_INFINITY,
    landmines: [
      'NEVER cycle a Coolify Postgres password in place — delete the volume and redeploy fresh (repo CLAUDE.md). Manual + Devon-driven only.',
    ],
  },
  // A Coolify API token (the orchestrator's estate lander: re-points an image tag and starts a
  // deploy). Coolify tokens name actions, not resources, so the scope at minting is the whole bound.
  'coolify-api-token': {
    maxAgeDays: 365,
    landmines: [
      'Mint the replacement in Coolify (Keys & Tokens) with exactly the permissions the registry row names; never read:sensitive (env responses then carry secret values) or root. Revoke the old token in Coolify after the new one is verified.',
    ],
  },
  'bws-machine-token': {
    maxAgeDays: 365,
    landmines: [
      'BWS machine tokens are console-minted only — create/revoke in the Bitwarden console; never via CLI.',
    ],
  },
  // The orchestrator's rotation executor's canary (ADR-0055 increment 4): a credential with no
  // consumer and no real provider, rotated only to prove the executor end to end. It never ages,
  // and this window never rotates it (it is rotated_by_sds).
  'rotation-canary': {
    maxAgeDays: Number.POSITIVE_INFINITY,
    landmines: [],
  },
  // Opaque M2M bearers the orchestrator (sds.alobar.net) authenticates. Coolify holds only
  // sha256(token) per key id, so no executor consumer kind can deploy a new value.
  'orchestrator-m2m-bearer': {
    maxAgeDays: 365,
    landmines: [
      'Coolify ORCHESTRATOR_M2M_CREDENTIALS holds sha256(token) per key id, never the token: replace only the hash of that entry, keep the key id and agent_id (attribution is permanent).',
      'Write ORCHESTRATOR_M2M_CREDENTIALS before ORCHESTRATOR_M2M_ROLES and verify each in the container before the next restart (roles without credentials fail boot closed); never restart while a dispatched run is live.',
    ],
  },
  // change-manager (change-mgr.alobar.net) bearers: plaintext Coolify env per scope.
  'change-manager-m2m-bearer': {
    maxAgeDays: 365,
    landmines: [
      'Never give two change-manager scope variables the same value: auth._token_scopes keeps the FIRST scope for a value (read, propose, observe, full), so a shared value is silently narrowed.',
      'An unset M2M_TOKEN* grants nothing: blanking one mid-rotation 401s every consumer of that scope until the redeploy lands.',
    ],
  },
};

// ── Rotation state (0600, same trust boundary as the baseline) ───────────

export class RotationStateIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RotationStateIntegrityError';
  }
}

export interface RotationState {
  /** key = `${credId}:${exposureId}` */
  resolvedExposures: Record<string, { ts: string; detail: string }>;
  lastRotated: Record<string, string>;
}

const EMPTY_STATE: RotationState = { resolvedExposures: {}, lastRotated: {} };

export function loadRotationState(file: string): RotationState {
  const parsed = loadValidated0600Json<Partial<RotationState>>(
    file,
    'rotation-state',
    RotationStateIntegrityError,
  );
  if (parsed === null) return structuredClone(EMPTY_STATE);
  return {
    resolvedExposures: parsed.resolvedExposures ?? {},
    lastRotated: parsed.lastRotated ?? {},
  };
}

export function saveRotationState(file: string, state: RotationState): void {
  saveValidated0600Json(file, state);
}

/**
 * Record a verified rotation: set `lastRotated[credId]` to `date` — a strict
 * `YYYY-MM-DD` (UTC midnight) or `'now'`. Refuses an id outside the registry, a
 * revoke-no-replacement credential (its revoke is recorded by the executor's
 * revoke-confirm, and a lastRotated written here would not mark it revoked), a
 * malformed or impossible date, and a date after `now` (a future lastRotated would
 * silence the age finding). Mutates `state`; the caller persists it.
 */
export function recordRotation(
  state: RotationState,
  specs: readonly CredentialSpec[],
  credId: string,
  date: string,
  now: string,
): { previous: string | undefined; recorded: string } {
  const spec = specs.find((s) => s.id === credId);
  if (!spec)
    throw new Error(`unknown credential id '${credId}' — not in any listed .cred-consumers.toml`);
  if (spec.disposition === 'revoke-no-replacement')
    throw new Error(
      `${credId} is revoke-no-replacement: there is no rotation to record — its revoke is recorded by the rotation executor's revoke-confirm`,
    );
  const nowMs = Date.parse(now);
  const ms = date === 'now' ? nowMs : parseIsoDay(date);
  if (ms === null) throw new Error(`invalid date '${date}' — use a real YYYY-MM-DD date or 'now'`);
  if (ms > nowMs) throw new Error(`date '${date}' is in the future`);
  const previous = state.lastRotated[credId];
  const recorded = new Date(ms).toISOString();
  state.lastRotated[credId] = recorded;
  return { previous, recorded };
}

/**
 * A revoke-no-replacement credential is recorded revoked when the executor's
 * revoke-confirm wrote it: completeRotation stamps the resolved exposure and
 * lastRotated with the same timestamp in one write. A lastRotated alone (an ordinary
 * rotation before a re-classification) is not a revoke.
 */
export function isRecordedRevoked(spec: CredentialSpec, state: RotationState): boolean {
  if (spec.disposition !== 'revoke-no-replacement') return false;
  const at = state.lastRotated[spec.id];
  if (at === undefined) return false;
  return spec.exposures.some((e) => state.resolvedExposures[`${spec.id}:${e.id}`]?.ts === at);
}

/** When a credential last rotated, as far as anything knows: the date its age is measured from. */
export function rotationAnchor(spec: CredentialSpec, state: RotationState): string | undefined {
  return state.lastRotated[spec.id] ?? spec.last_rotated ?? spec.created;
}

// ── Findings ─────────────────────────────────────────────────────────────────────

export function credTarget(credId: string): string {
  return `cred:${credId}`;
}

/** Findings for the current registry + state. Pure — no I/O. */
export function credFindings(
  specs: CredentialSpec[],
  state: RotationState,
  now: string,
): Finding[] {
  const findings: Finding[] = [];
  const nowMs = new Date(now).getTime();
  for (const spec of specs) {
    if (spec.rotate_requested_invalid !== undefined) {
      findings.push({
        severity: 'WARN',
        check: 'cred.invalid-rotate-requested',
        target: credTarget(spec.id),
        facts: { id: spec.id, class: spec.class },
        detail: `${credTarget(spec.id)} has rotate_requested = ${spec.rotate_requested_invalid}, which is not a quoted real date ("YYYY-MM-DD") — the request is ignored; fix it in its .cred-consumers.toml`,
      });
    }
    const openExposures = spec.exposures.filter(
      (e) => !state.resolvedExposures[`${spec.id}:${e.id}`],
    );
    if (openExposures.length) {
      const exp = openExposures[0];
      findings.push({
        severity: 'FAIL',
        check: 'cred.exposure-rotate',
        target: credTarget(spec.id),
        facts: { id: spec.id, class: spec.class, exposure_id: exp.id, exposure_date: exp.date },
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
        facts: { id: spec.id, class: spec.class },
        detail: `${credTarget(spec.id)} declares class '${spec.class}', which has no rotation policy — it is never aged; fix the class in its .cred-consumers.toml`,
      });
      continue;
    }
    // A revoked credential has nothing left to rotate.
    if (isRecordedRevoked(spec, state)) continue;
    const anchor = rotationAnchor(spec, state);
    if (anchor && Number.isFinite(policy.maxAgeDays)) {
      const ageDays = (nowMs - new Date(anchor).getTime()) / 86400_000;
      if (ageDays > policy.maxAgeDays) {
        findings.push({
          severity: 'WARN',
          check: 'cred.rotation-age',
          target: credTarget(spec.id),
          facts: { id: spec.id, class: spec.class, anchor },
          detail: `${credTarget(spec.id)} (class ${spec.class}) is ${Math.floor(ageDays)}d old — class max is ${policy.maxAgeDays}d; schedule rotation`,
        });
      }
    }
    const requestedMs = spec.rotate_requested ? Date.parse(spec.rotate_requested) : NaN;
    if (nowMs >= requestedMs) {
      const rotated = state.lastRotated[spec.id] ?? spec.last_rotated;
      if (!rotated || Date.parse(rotated) < requestedMs) {
        findings.push({
          severity: 'WARN',
          check: 'cred.rotation-requested',
          target: credTarget(spec.id),
          facts: { id: spec.id, class: spec.class, rotate_requested: spec.rotate_requested! },
          detail: `${credTarget(spec.id)} (class ${spec.class}) has a rotation requested ${spec.rotate_requested}; last rotated ${rotated ?? 'never'} — rotate, then record-rotation`,
        });
      }
    }
  }
  return findings;
}

// ── Plans ────────────────────────────────────────────────────────────────────────

/** The findings that start a rotation. For a credential the SDS rotates, these reach only the
 *  rotation proposer; every other finding about it (a bad registry field, an unknown class) is
 *  still the scan's to report. */
export const ROTATION_TRIGGER_CHECKS: ReadonlySet<string> = new Set([
  'cred.exposure-rotate',
  'cred.rotation-age',
  'cred.rotation-requested',
]);

/** What the 03:00 scan posts: every finding except the rotation triggers of SDS-rotated
 *  credentials, which would otherwise become change-manager security items that offer a manual
 *  checklist for a rotation the SDS owns. */
export function scanFindings(findings: Finding[], specs: CredentialSpec[]): Finding[] {
  const sds = new Set(specs.filter((s) => s.rotated_by_sds === true).map((s) => s.id));
  return findings.filter(
    (f) => !(ROTATION_TRIGGER_CHECKS.has(f.check) && sds.has(String(f.facts?.id))),
  );
}

/** The manual checklist for a due credential: its class's landmines, then the console steps. */
function rotationClassification(spec: CredentialSpec): Classification {
  const policy = CLASS_POLICY[spec.class];
  const where = spec.provider_identity ?? spec.provider ?? spec.class;
  const steps =
    spec.disposition === 'revoke-no-replacement'
      ? [
          `1. REVOKE (Devon): revoke the credential at the provider console (${where}). No replacement is needed.`,
          `2. Retire the BWS copy${spec.bws_uuid ? ` (${spec.bws_uuid})` : ''}.`,
        ]
      : [
          `1. CREATE (Devon): mint the replacement at the provider (${where})` +
            (spec.replacement_scope ? ` — scope: ${spec.replacement_scope}` : '') +
            `; name it distinctly (keeper-naming discipline).`,
          `2. STORE and DEPLOY (Devon): update the keeper${spec.bws_uuid ? ` (BWS ${spec.bws_uuid})` : ''} in place, then every mapped consumer.`,
          `3. REVOKE (Devon): revoke the OLD credential at the provider console once the consumers verify.`,
          `4. Record it: node dist/cli/security-drift-cli.js record-rotation --cred ${spec.id} --date now`,
        ];
  return {
    tier: 'URGENT',
    kind: 'question',
    risk: 'caution',
    remediation: { manual: [...(policy?.landmines ?? []), ...steps] },
    title: `Rotate ${spec.id} (${spec.class}) — manual`,
  };
}

/**
 * Build the Classification for every managed credential's findings, keyed by
 * `${check}|${target}` (the lookup the taxonomy uses for cred.* checks).
 */
export function buildCredClassifications(specs: CredentialSpec[]): Record<string, Classification> {
  const out: Record<string, Classification> = {};
  for (const spec of specs) {
    const target = credTarget(spec.id);
    const rotate = rotationClassification(spec);
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
    out[`cred.invalid-rotate-requested|${target}`] = {
      tier: 'NORMAL',
      kind: 'question',
      risk: 'caution',
      remediation: {
        manual: [
          `Fix ${spec.id}'s rotate_requested in its .cred-consumers.toml: a quoted real date, e.g. rotate_requested = "2026-10-07".`,
        ],
      },
      title: `Invalid rotate_requested: ${spec.id}`,
    };
    out[`cred.unknown-class|${target}`] = {
      tier: 'NORMAL',
      kind: 'question',
      risk: 'caution',
      remediation: {
        manual: [
          `Set ${spec.id}'s class to one defined in CLASS_POLICY (src/security-drift/cred-rotation.ts), or add the class there.`,
        ],
      },
      title: `Unknown credential class: ${spec.id} (${spec.class})`,
    };
  }
  return out;
}
