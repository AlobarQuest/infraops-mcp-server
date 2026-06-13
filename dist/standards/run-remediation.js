import { isAutoApplicable } from "./executor.js";
import { proposalIdentity } from "./report.js";
import { buildRemediationReport, } from "./remediation-report.js";
/**
 * The remediation core. Re-audits each instance LIVE (the idempotency guard —
 * we act on current reality, not the possibly-stale morning report), partitions
 * proposals into auto-applicable vs escalated, applies the safe ones (unless the
 * runaway guard trips), asks for a plan on the rest, and assembles the report.
 * Dependency-injected so it is fully testable without network or model access —
 * mirrors buildDriftReport in run-audit.ts / report.ts.
 */
export async function runRemediation(instances, morning, generatedAt, sourceReport, deps) {
    // 1. Re-audit live. Isolate per-instance failures (never abort the run).
    const live = [];
    const okInstances = new Set();
    let cleanlyAudited = false;
    for (const inst of instances) {
        try {
            const res = await deps.audit(inst);
            okInstances.add(inst);
            if (!res.meta.errors || res.meta.errors.length === 0)
                cleanlyAudited = true;
            for (const p of res.proposals)
                live.push({ instance: inst, proposal: p });
        }
        catch {
            // instance unreachable this run — its drift is unknown, not resolved
        }
    }
    // 2. Partition.
    const safe = live.filter((t) => isAutoApplicable(t.proposal));
    const escalateTagged = live.filter((t) => !isAutoApplicable(t.proposal));
    // 3. Runaway guard: a sudden fleet-wide spike of "safe" fixes is the signature
    // of a bad rule — apply nothing and escalate everything instead.
    const runawayTripped = safe.length > deps.maxAutoApplies;
    const toApply = runawayTripped ? [] : safe;
    const toEscalate = runawayTripped ? live : escalateTagged;
    // 4. Apply safe (per-item isolation lives in deps.apply — it never throws).
    const applied = [];
    for (const t of toApply) {
        applied.push(await deps.apply(t.proposal, t.instance, { dryRun: deps.dryRun }));
    }
    // 5. Plan escalations.
    const escalations = [];
    for (const t of toEscalate) {
        const plan = await deps.plan(t.proposal);
        escalations.push({
            proposal_id: t.proposal.id,
            target: t.proposal.target,
            risk: t.proposal.risk,
            kind: t.proposal.kind,
            reasoning: t.proposal.reasoning,
            plan,
        });
    }
    // 6. Self-resolved: morning proposals (for instances we could audit this run)
    // that are no longer present live.
    const liveIds = new Set(live.map((t) => proposalIdentity(t.instance, t.proposal)));
    let selfResolved = 0;
    if (morning) {
        for (const [inst, sec] of Object.entries(morning.instances)) {
            if (!okInstances.has(inst))
                continue; // couldn't confirm → not "resolved"
            for (const p of sec.proposals ?? []) {
                if (!liveIds.has(proposalIdentity(inst, p)))
                    selfResolved++;
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
//# sourceMappingURL=run-remediation.js.map