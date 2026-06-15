// Maps classified findings to change-manager security escalations, and records the
// plan-hash (keyed by fingerprint) for the 4am integrity gate.
//
// Security escalations POST directly to /api/sync as opaque JSON (the web app stores
// `plan` as a JSON object), so the plan shape here is free to carry an exact
// remediation (exec | manual) without going through the strict drift-contract zod
// types. proposal_id is crafted so the web app's rule_key_of() (split on ":") yields
// a clean "sec.<check>" rule key (see change-manager app/identity.py).

import type { DiffItem } from "./baseline.js";
import { fingerprint } from "./baseline.js";
import { planHash } from "./canonical.js";
import type { EmitState } from "./emit-state.js";
import type { Finding } from "./scan-parser.js";
import type { Classification, Remediation, Tier } from "./taxonomy.js";

export interface SecurityPlan {
  generated_by: "security-scan";
  tier: Tier;
  root_cause: string;
  remediation: Remediation; // { exec: string[][] } | { manual: string[] }
  rollback: string;
  source: "security";
  blind_spots: string;
}

export interface SecurityEscalation {
  proposal_id: string;
  instance: "mac";
  target: { provider: "security"; resource_type: string; uuid: string; name: string };
  risk: string;
  kind: "remediation" | "question";
  reasoning: string;
  plan: SecurityPlan;
  urgent: boolean;
  note?: string;
}

const BLIND_SPOTS =
  "File-scan does NOT cover secrets in env vars (ps/proc) or secrets surviving in git history — " +
  "a clean working tree never means a leaked secret is gone; rotation is still required.";

export interface ClassifiedFinding {
  finding: Finding;
  classification: Classification;
}

/** Build one escalation from a classified finding. */
export function toEscalation(cf: ClassifiedFinding): SecurityEscalation {
  const { finding, classification } = cf;
  const fp = fingerprint(finding.check, finding.target);
  const plan: SecurityPlan = {
    generated_by: "security-scan",
    tier: classification.tier,
    root_cause: finding.detail,
    remediation: classification.remediation,
    rollback:
      "exec" in classification.remediation
        ? "Prior file mode/owner recorded in the security-drift rollback log; restore from there."
        : "n/a — manual remediation (human applies and verifies).",
    source: "security",
    blind_spots: BLIND_SPOTS,
  };
  return {
    proposal_id: `sec.${finding.check}:${fp.slice(0, 12)}`,
    instance: "mac",
    target: { provider: "security", resource_type: finding.check.split(".")[0], uuid: fp, name: classification.title },
    risk: classification.risk,
    kind: classification.kind,
    reasoning: `[${classification.tier}] ${finding.check} — ${finding.detail}`,
    plan,
    urgent: classification.tier === "URGENT",
  };
}

export interface BuiltEscalations {
  escalations: SecurityEscalation[];
  /** fingerprint → plan-hash for every emitted escalation, to merge into emit-state */
  hashes: Record<string, string>;
}

/** Build the full set of escalations to POST, plus the plan-hashes to record. */
export function buildEscalations(items: ClassifiedFinding[], now: string): BuiltEscalations {
  const escalations: SecurityEscalation[] = [];
  const hashes: Record<string, string> = {};
  for (const cf of items) {
    const esc = toEscalation(cf);
    escalations.push(esc);
    hashes[esc.target.uuid] = planHash(esc.plan);
  }
  return { escalations, hashes };
}

/** Merge freshly-emitted hashes into the existing emit-state with a timestamp. */
export function mergeEmitState(state: EmitState, hashes: Record<string, string>, now: string): EmitState {
  const next: EmitState = { ...state };
  for (const [fp, hash] of Object.entries(hashes)) next[fp] = { hash, ts: now };
  return next;
}

/** Pick the escalations that correspond to NEW/changed findings (for the immediate email). */
export function newEscalations(escalations: SecurityEscalation[], diffs: DiffItem[]): SecurityEscalation[] {
  const newFps = new Set(diffs.map((d) => d.fingerprint));
  return escalations.filter((e) => newFps.has(e.target.uuid));
}
