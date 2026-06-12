/**
 * Stable identity for a proposal across runs. The proposal `id` carries a random
 * suffix (nanoid8) so it cannot be compared directly; the prefix before the colon
 * is the remediation_key/rule_id, which together with the instance and target uuid
 * is stable for "the same deviation on the same resource".
 */
export function proposalIdentity(instance, p) {
    const ruleKey = p.id.split(":")[0];
    return `${instance}::${ruleKey}::${p.target.uuid}`;
}
function toDeltaItem(instance, identity, p) {
    return { instance, identity, description: p.description, risk: p.risk, reasoning: p.reasoning };
}
function collectProposals(instances) {
    const m = new Map();
    for (const [inst, sec] of Object.entries(instances)) {
        for (const p of sec.proposals ?? []) {
            m.set(proposalIdentity(inst, p), { instance: inst, proposal: p });
        }
    }
    return m;
}
/**
 * Day-over-day delta. A prior proposal counts as `resolved` ONLY when its instance
 * was successfully audited this run — if the instance is unreachable now (e.g. the
 * dev mini is offline) its prior deviations are *unknown*, not resolved, so we must
 * not falsely report them as fixed.
 */
export function diffProposals(prevInstances, currInstances) {
    const prevMap = collectProposals(prevInstances ?? {});
    const currMap = collectProposals(currInstances);
    const newItems = [];
    const resolved = [];
    let unchanged = 0;
    for (const [id, { instance, proposal }] of currMap) {
        if (prevMap.has(id))
            unchanged++;
        else
            newItems.push(toDeltaItem(instance, id, proposal));
    }
    for (const [id, { instance, proposal }] of prevMap) {
        if (currMap.has(id))
            continue;
        const sec = currInstances[instance];
        if (sec && sec.ok)
            resolved.push(toDeltaItem(instance, id, proposal));
        // instance not successfully audited this run → status unknown, omit from resolved
    }
    return { new: newItems, resolved, unchanged };
}
function computeTotals(instances) {
    const by_risk = { safe: 0, caution: 0, destructive: 0 };
    const by_kind = { remediation: 0, question: 0 };
    let total = 0;
    let ok = 0;
    let failed = 0;
    for (const sec of Object.values(instances)) {
        if (!sec.ok) {
            failed++;
            continue;
        }
        ok++;
        for (const p of sec.proposals ?? []) {
            total++;
            by_risk[p.risk]++;
            by_kind[p.kind]++;
        }
    }
    return { total_proposals: total, by_risk, by_kind, instances_ok: ok, instances_failed: failed };
}
/**
 * Run the audit across instances and assemble a drift report with a delta versus
 * the previous report. The audit function is injected so this is testable without
 * network access. Each instance is isolated: a thrown audit becomes an `error`
 * section, never aborting the others.
 */
export async function buildDriftReport(instances, auditFn, prevReport, generatedAt) {
    const sections = {};
    for (const inst of instances) {
        try {
            const res = await auditFn(inst);
            sections[inst] = {
                ok: true,
                standards_source: res.meta.standards_source,
                summary: res.summary,
                proposals: res.proposals,
                ...(res.meta.errors ? { errors: res.meta.errors } : {}),
            };
        }
        catch (e) {
            sections[inst] = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    }
    return {
        generated_at: generatedAt,
        instances: sections,
        totals: computeTotals(sections),
        delta: diffProposals(prevReport?.instances ?? null, sections),
    };
}
/** Deterministic human-readable summary for the daily email digest. */
export function renderMarkdown(report) {
    const { totals, delta } = report;
    const lines = [];
    lines.push(`# Infra Standards Drift — ${report.generated_at}`);
    lines.push("");
    lines.push(`**${totals.total_proposals} deviation(s)** across ${totals.instances_ok} instance(s) ` +
        `(${totals.by_risk.safe} safe, ${totals.by_risk.caution} caution, ${totals.by_risk.destructive} destructive)` +
        (totals.instances_failed > 0 ? ` · ${totals.instances_failed} instance(s) unreachable` : ""));
    lines.push("");
    // Per-instance status line
    for (const [inst, sec] of Object.entries(report.instances)) {
        if (!sec.ok) {
            lines.push(`- **${inst}:** ⚠️ unreachable — ${sec.error}`);
            continue;
        }
        const n = sec.summary?.total_proposals ?? 0;
        const partial = sec.errors?.length ? ` (partial: ${sec.errors.join("; ")})` : "";
        lines.push(`- **${inst}:** ${sec.standards_source} · ${n} deviation(s)${partial}`);
    }
    lines.push("");
    // Delta
    lines.push("## Changes since last run");
    lines.push(`- New: ${delta.new.length} · Resolved: ${delta.resolved.length} · Unchanged: ${delta.unchanged}`);
    if (delta.new.length) {
        lines.push("");
        lines.push("**New:**");
        for (const d of delta.new)
            lines.push(`- [${d.instance}] ${d.description} _(${d.risk})_`);
    }
    if (delta.resolved.length) {
        lines.push("");
        lines.push("**Resolved:**");
        for (const d of delta.resolved)
            lines.push(`- [${d.instance}] ${d.description}`);
    }
    lines.push("");
    // Full current list grouped by instance
    lines.push("## All current deviations");
    for (const [inst, sec] of Object.entries(report.instances)) {
        if (!sec.ok)
            continue;
        const props = sec.proposals ?? [];
        lines.push("");
        lines.push(`### ${inst} (${props.length})`);
        if (!props.length) {
            lines.push("- _none — conforms_");
            continue;
        }
        for (const p of props) {
            const tag = p.kind === "question" ? "❓" : `🔧 ${p.risk}`;
            lines.push(`- ${tag}: ${p.description}`);
        }
    }
    lines.push("");
    return lines.join("\n");
}
//# sourceMappingURL=report.js.map