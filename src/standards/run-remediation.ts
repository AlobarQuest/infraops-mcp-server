import type { CoolifyInstance } from "../services/coolify-client.js";
import type { AuditResult } from "./run-audit.js";
import type { Proposal } from "./check-engine.js";
import type { ApplyResult } from "./executor.js";
import { isAutoApplicable } from "./executor.js";
import type { ProbeResult } from "./executor.js";
import type { RemediationPlan } from "./remediation-plan.js";
import { buildHandoff } from "./handoff-brief.js";
import { proposalIdentity, type DriftReport } from "./report.js";
import {
  buildRemediationReport,
  type Escalation,
  type RemediationReport,
} from "./remediation-report.js";

export interface RemediationDeps {
  audit: (inst: CoolifyInstance) => Promise<AuditResult>;
  apply: (p: Proposal, inst: CoolifyInstance, opts: { dryRun?: boolean }) => Promise<ApplyResult>;
  plan: (p: Proposal) => Promise<RemediationPlan>;
  /** Pre-apply gate: returns ok=false (with a reason) to reroute a "safe" proposal to escalation. */
  verify: (p: Proposal, inst: CoolifyInstance) => Promise<{ ok: boolean; reason: string; probe?: ProbeResult; url?: string }>;
  appBrainLookup?: (repo: string) => Promise<boolean>;
  maxAutoApplies: number;
  dryRun: boolean;
}

interface Tagged {
  instance: CoolifyInstance;
  proposal: Proposal;
  /** Set when a verify gate held an otherwise-safe proposal back for review. */
  note?: string;
  probe?: ProbeResult;
  url?: string;
}

/**
 * The remediation core. Re-audits each instance LIVE (the idempotency guard —
 * we act on current reality, not the possibly-stale morning report), partitions
 * proposals into auto-applicable vs escalated, applies the safe ones (unless the
 * runaway guard trips), asks for a plan on the rest, and assembles the report.
 * Dependency-injected so it is fully testable without network or model access —
 * mirrors buildDriftReport in run-audit.ts / report.ts.
 */
export async function runRemediation(
  instances: CoolifyInstance[],
  morning: DriftReport | null,
  generatedAt: string,
  sourceReport: string,
  deps: RemediationDeps,
): Promise<{ report: RemediationReport; cleanlyAudited: boolean }> {
  // 1. Re-audit live. Isolate per-instance failures (never abort the run).
  const live: Tagged[] = [];
  const okInstances = new Set<CoolifyInstance>();
  let cleanlyAudited = false;

  for (const inst of instances) {
    try {
      const res = await deps.audit(inst);
      okInstances.add(inst);
      if (!res.meta.errors || res.meta.errors.length === 0) cleanlyAudited = true;
      for (const p of res.proposals) live.push({ instance: inst, proposal: p });
    } catch {
      // instance unreachable this run — its drift is unknown, not resolved
    }
  }

  // 2. Partition.
  const safe = live.filter((t) => isAutoApplicable(t.proposal));
  const escalateTagged = live.filter((t) => !isAutoApplicable(t.proposal));

  // 3. Runaway guard: a sudden fleet-wide spike of "safe" fixes is the signature
  // of a bad rule — apply nothing and escalate everything instead.
  const runawayTripped = safe.length > deps.maxAutoApplies;

  // 4. Verify gate (skipped on the runaway path): a "safe" proposal that fails its
  // pre-apply check (e.g. enable_healthcheck on an app that isn't running:healthy)
  // is rerouted to escalation with a note, rather than auto-applied.
  let toApply: Tagged[];
  let toEscalate: Tagged[];
  if (runawayTripped) {
    toApply = [];
    toEscalate = live;
  } else {
    toApply = [];
    const verifyHeld: Tagged[] = [];
    for (const t of safe) {
      const v = await deps.verify(t.proposal, t.instance);
      if (v.ok) toApply.push(t);
      else verifyHeld.push({ ...t, note: v.reason, probe: v.probe, url: v.url });
    }
    toEscalate = [...escalateTagged, ...verifyHeld];
  }

  // 5. Apply safe (per-item isolation lives in deps.apply — it never throws).
  const applied: ApplyResult[] = [];
  for (const t of toApply) {
    applied.push(await deps.apply(t.proposal, t.instance, { dryRun: deps.dryRun }));
  }

  // 6. Plan escalations.
  const escalations: Escalation[] = [];
  for (const t of toEscalate) {
    const plan = await deps.plan(t.proposal);
    const { lane, handoff, handoff_brief } = await buildHandoff(
      t.proposal, t.probe, t.url, t.instance,
      deps.appBrainLookup ? { appBrainLookup: deps.appBrainLookup } : {},
    );
    escalations.push({
      proposal_id: t.proposal.id,
      instance: t.instance,
      target: t.proposal.target,
      risk: t.proposal.risk,
      kind: t.proposal.kind,
      reasoning: t.proposal.reasoning,
      plan,
      lane,
      ...(handoff ? { handoff } : {}),
      ...(handoff_brief ? { handoff_brief } : {}),
      ...(t.note ? { note: t.note } : {}),
    });
  }

  // 7. Self-resolved: morning proposals (for instances we could audit this run)
  // that are no longer present live.
  const liveIds = new Set(live.map((t) => proposalIdentity(t.instance, t.proposal)));
  let selfResolved = 0;
  if (morning) {
    for (const [inst, sec] of Object.entries(morning.instances)) {
      if (!okInstances.has(inst as CoolifyInstance)) continue; // couldn't confirm → not "resolved"
      for (const p of sec.proposals ?? []) {
        if (!liveIds.has(proposalIdentity(inst, p))) selfResolved++;
      }
    }
  }

  const report = buildRemediationReport({
    generatedAt,
    sourceReport,
    applied,
    escalations,
    selfResolved,
    runawayTripped,
  });
  return { report, cleanlyAudited };
}
