// WS-0.7 credential-rotation detection + plan building.
//
// DETECT: emits `cred.exposure-rotate` (FAIL, one-shot rotate-now until the
// exposure is recorded resolved) and `cred.rotation-age` (WARN past the per-class
// max age) findings, merged into the 3am security-drift run via extraFindings.
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

import { loadValidated0600Json, saveValidated0600Json } from "./validated-store.js";
import type { Finding } from "./scan-parser.js";
import type { Classification, Remediation } from "./taxonomy.js";
import type { ConsumerSpec, CredentialSpec } from "./cred-consumers.js";

export type ProviderProbe = "github" | "openrouter" | "openai" | "bitbucket";

interface ClassPolicy {
  maxAgeDays: number;
  probe?: ProviderProbe;
  /** may this class produce an executor-runnable plan at all? */
  executor: boolean;
  /** class-specific landmine steps prepended to every manual checklist */
  landmines: string[];
}

// Per-class policy (mirrors the infra-brain `cred.rotation-age` / landmine rules).
export const CLASS_POLICY: Record<string, ClassPolicy> = {
  "github-pat-classic": {
    maxAgeDays: 180,
    probe: "github",
    executor: true,
    landmines: [
      "LANDMINE: deleting a GitHub PAT also deletes SSH/deploy keys that PAT created — enumerate account SSH keys (GitHub → Settings → SSH and GPG keys; API needs admin:public_key) AND repo deploy keys BEFORE revoking; re-add any load-bearing key via the web UI first.",
      "GitHub 'last used' lags — never keep/revoke by it; the replacement keeper is name-distinct.",
    ],
  },
  "github-pat-fine-grained": {
    maxAgeDays: 180,
    probe: "github",
    executor: true,
    landmines: [
      "LANDMINE: deleting a GitHub PAT also deletes SSH/deploy keys it created — enumerate before revoking.",
    ],
  },
  "openrouter-key": { maxAgeDays: 365, probe: "openrouter", executor: true, landmines: [] },
  "openai-key": { maxAgeDays: 365, probe: "openai", executor: true, landmines: [] },
  // Atlassian API token (Bitbucket): Basic auth (email:token), not Bearer. The probe
  // needs probe_email + probe_workspace on the registry entry (below).
  "atlassian-api-token": { maxAgeDays: 365, probe: "bitbucket", executor: true, landmines: [] },
  "brain-mcp-key": {
    maxAgeDays: 365,
    executor: false,
    landmines: [
      "LANDMINE: rotating a brain MCP_ACCESS_KEY re-keys its live claude.ai connector — pair the rotation with an immediate connector reconfig; never batch unattended.",
    ],
  },
  "coolify-pg-password": {
    maxAgeDays: Number.POSITIVE_INFINITY,
    executor: false,
    landmines: [
      "NEVER cycle a Coolify Postgres password in place — delete the volume and redeploy fresh (repo CLAUDE.md). Manual + Devon-driven only.",
    ],
  },
  "bws-machine-token": {
    maxAgeDays: 365,
    executor: false,
    landmines: ["BWS machine tokens are console-minted only — create/revoke in the Bitwarden console; never via CLI."],
  },
};

// Consumer kinds the executor knows how to deploy to. Anything else forces manual.
const SUPPORTED_CONSUMER_KINDS = new Set(["bws-secret", "keychain", "coolify-env", "gh-actions-secret"]);

// ── Rotation state (0600, same trust boundary as baseline/emit-state) ───────────

export class RotationStateIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RotationStateIntegrityError";
  }
}

export interface RotationState {
  /** key = `${credId}:${exposureId}` */
  resolvedExposures: Record<string, { ts: string; detail: string }>;
  lastRotated: Record<string, string>;
}

const EMPTY_STATE: RotationState = { resolvedExposures: {}, lastRotated: {} };

export function loadRotationState(file: string): RotationState {
  const parsed = loadValidated0600Json<Partial<RotationState>>(file, "rotation-state", RotationStateIntegrityError);
  if (parsed === null) return structuredClone(EMPTY_STATE);
  return {
    resolvedExposures: parsed.resolvedExposures ?? {},
    lastRotated: parsed.lastRotated ?? {},
  };
}

export function saveRotationState(file: string, state: RotationState): void {
  saveValidated0600Json(file, state);
}

// ── Findings ─────────────────────────────────────────────────────────────────────

export function credTarget(credId: string): string {
  return `cred:${credId}`;
}

/** Findings for the current registry + state. Pure — no I/O. */
export function credFindings(specs: CredentialSpec[], state: RotationState, now: string): Finding[] {
  const findings: Finding[] = [];
  const nowMs = new Date(now).getTime();
  for (const spec of specs) {
    const openExposures = spec.exposures.filter((e) => !state.resolvedExposures[`${spec.id}:${e.id}`]);
    if (openExposures.length) {
      const exp = openExposures[0];
      findings.push({
        severity: "FAIL",
        check: "cred.exposure-rotate",
        target: credTarget(spec.id),
        detail: `${credTarget(spec.id)} (class ${spec.class}, fp ${spec.fingerprint_sha256_8 ?? "?"}) exposed ${exp.date} via ${exp.source ?? "recorded exposure"} — rotate now (exposure ${exp.id})`,
      });
      continue; // exposure supersedes age for the same credential
    }
    const policy = CLASS_POLICY[spec.class];
    const anchor = state.lastRotated[spec.id] ?? spec.last_rotated ?? spec.created;
    if (!policy || !anchor || !Number.isFinite(policy.maxAgeDays)) continue;
    const ageDays = (nowMs - new Date(anchor).getTime()) / 86400_000;
    if (ageDays > policy.maxAgeDays) {
      findings.push({
        severity: "WARN",
        check: "cred.rotation-age",
        target: credTarget(spec.id),
        detail: `${credTarget(spec.id)} (class ${spec.class}) is ${Math.floor(ageDays)}d old — class max is ${policy.maxAgeDays}d; schedule rotation`,
      });
    }
  }
  return findings;
}

// ── Plans ────────────────────────────────────────────────────────────────────────

/** The executor-runnable rotation plan — hash-gated verbatim through change-manager.
 *  NO secret value ever appears here: everything is referenced by BWS UUID,
 *  Keychain item name, or consumer coordinates. */
export interface RotationPlanSpec {
  credId: string;
  credClass: string;
  fingerprint8?: string;
  consumersVerified: string;
  /** reissue path: Keychain staging item Devon fills with the NEW provider-minted value */
  staging?: { service: string; account: string };
  /** reissue path: BWS keeper secret edited in place (UUID stays stable for by-UUID fetchers) */
  keeperBwsUuid?: string;
  /** reissue path: distinctly-named quarantine secret holding the OLD value until confirmed dead */
  quarantineName?: string;
  bwsProjectId?: string;
  /** revoke-no-replacement path: BWS secrets that HOLD the old value — probed until dead, then retired */
  retireBwsUuids: string[];
  consumers: ConsumerSpec[];
  providerProbe: ProviderProbe;
  /** Basic-auth probe context (bitbucket): the account email and workspace. Non-secret. */
  probeEmail?: string;
  probeWorkspace?: string;
  exposureIds: string[];
  /** Devon's console steps (create/revoke are ALWAYS human) — shown in change-manager */
  manualSteps: string[];
}

export const STAGING_SERVICE = "cred-rotation";

/** Ops/Platform — where quarantine copies are created (same project as the keepers). */
const DEFAULT_BWS_PROJECT = "26ff7e3e-8769-45ff-885c-b415013b4bbf";

function manualClassification(spec: CredentialSpec, reasons: string[], steps: string[]): Classification {
  const policy = CLASS_POLICY[spec.class];
  return {
    tier: "URGENT",
    kind: "question",
    risk: "caution",
    remediation: { manual: [...(policy?.landmines ?? []), ...reasons.map((r) => `NOT executor-eligible: ${r}`), ...steps] },
    title: `Rotate ${spec.id} (${spec.class}) — manual`,
  };
}

function consoleSteps(spec: CredentialSpec): string[] {
  const steps: string[] = [];
  if (spec.disposition === "reissue" || spec.disposition === "reissue-least-privilege") {
    steps.push(
      `1. CREATE (Devon): mint the replacement at the provider (${spec.provider_identity ?? spec.provider ?? spec.class})` +
        (spec.replacement_scope ? ` — scope: ${spec.replacement_scope}` : "") +
        `; name it distinctly (keeper-naming discipline).`,
      `2. STAGE (Devon, real Terminal): security add-generic-password -U -s ${STAGING_SERVICE} -a ${spec.id} -T /usr/bin/security -w`,
      `3. Approve this item — the executor then stores (quarantines old + updates BWS ${spec.bws_uuid ?? "?"} in place), deploys to all mapped consumers, and verifies the new credential + consumers.`,
      `4. REVOKE (Devon): once the window reports verify green, revoke the OLD credential at the provider console, then re-approve; the executor confirms the old value is dead (401) before retiring the quarantine copy and closing the exposure.`,
    );
  } else {
    steps.push(
      `1. REVOKE (Devon): revoke the credential at the provider console (${spec.provider_identity ?? spec.provider ?? spec.class}). No replacement needed — mapped consumer set is storage-only/empty.`,
      `2. Re-approve this item — the executor confirms the old value is dead (401), retires the BWS copy, verifies the current keeper still authenticates, and closes the exposure.`,
    );
  }
  return steps;
}

/**
 * Build the Classification for every managed credential's findings, keyed by
 * `${check}|${target}` (the lookup the taxonomy uses for cred.* checks).
 */
export function buildCredClassifications(specs: CredentialSpec[], state: RotationState): Record<string, Classification> {
  const out: Record<string, Classification> = {};
  for (const spec of specs) {
    const target = credTarget(spec.id);
    const rotate = rotationClassification(spec, state);
    out[`cred.exposure-rotate|${target}`] = rotate;
    out[`cred.rotation-age|${target}`] = {
      ...rotate,
      tier: "NORMAL",
      title: `Rotation due: ${spec.id} (${spec.class})`,
    };
  }
  return out;
}

function rotationClassification(spec: CredentialSpec, state: RotationState): Classification {
  const policy = CLASS_POLICY[spec.class];
  const steps = consoleSteps(spec);
  const blockers: string[] = [];

  if (!policy) blockers.push(`unknown credential class '${spec.class}'`);
  else if (!policy.executor) blockers.push(`class ${spec.class} is never executor-run (manual lane)`);
  if (!spec.consumers_verified) blockers.push("consumer set not attested (consumers_verified missing) — FAIL-SAFE: never revoke an unmapped credential");
  for (const pre of spec.rotation_preconditions) blockers.push(`open precondition: ${pre}`);
  const unsupported = spec.consumers.filter((c) => !SUPPORTED_CONSUMER_KINDS.has(c.kind));
  for (const c of unsupported) blockers.push(`consumer kind '${c.kind}' not supported by the executor`);
  if (!spec.bws_uuid) blockers.push("no BWS copy of the old value — executor cannot confirm provider revoke (401 probe)");
  if (policy && !policy.probe) blockers.push(`class ${spec.class} has no provider probe`);
  // The bitbucket probe is Basic auth (email:token) against /repositories/{workspace};
  // both are non-secret and required, else verify-before-revoke can't run.
  if (policy?.probe === "bitbucket" && (!spec.probe_email || !spec.probe_workspace)) {
    blockers.push("bitbucket probe requires probe_email + probe_workspace on the registry entry");
  }

  if (blockers.length) return manualClassification(spec, blockers, steps);

  const reissue = spec.disposition === "reissue" || spec.disposition === "reissue-least-privilege";
  const openExposures = spec.exposures.filter((e) => !state.resolvedExposures[`${spec.id}:${e.id}`]).map((e) => e.id);
  const plan: RotationPlanSpec = {
    credId: spec.id,
    credClass: spec.class,
    fingerprint8: spec.fingerprint_sha256_8,
    consumersVerified: spec.consumers_verified!,
    retireBwsUuids: reissue ? [] : [spec.bws_uuid!],
    consumers: spec.consumers,
    providerProbe: policy!.probe!,
    ...(spec.probe_email ? { probeEmail: spec.probe_email } : {}),
    ...(spec.probe_workspace ? { probeWorkspace: spec.probe_workspace } : {}),
    exposureIds: openExposures,
    manualSteps: [...policy!.landmines, ...steps],
    ...(reissue
      ? {
          staging: { service: STAGING_SERVICE, account: spec.id },
          keeperBwsUuid: spec.bws_uuid!,
          quarantineName: `${spec.id}-pre-rotation-quarantine`,
          bwsProjectId: DEFAULT_BWS_PROJECT,
        }
      : {}),
  };
  const remediation: Remediation = { rotation: plan };
  return {
    tier: "URGENT",
    kind: "remediation",
    risk: "caution",
    remediation,
    title: `Rotate ${spec.id} (${spec.class}) — executor-assisted`,
  };
}
