import type { Proposal, Risk } from './check-engine.js';
import type { AuditResult } from './run-audit.js';
import type { CoolifyInstance } from '../services/coolify-client.js';

/** One audited instance's slice of a drift report. */
export interface InstanceSection {
  ok: boolean;
  standards_source?: AuditResult['meta']['standards_source'];
  summary?: AuditResult['summary'];
  proposals?: Proposal[];
  /** Per-endpoint read errors (instance partially reachable). */
  errors?: string[];
  /** Instance-level hard failure (the audit threw — e.g. instance unreachable). */
  error?: string;
}

export interface DeltaItem {
  instance: string;
  identity: string;
  description: string;
  risk: string;
  reasoning: string;
}

export interface DriftDelta {
  new: DeltaItem[];
  resolved: DeltaItem[];
  unchanged: number;
}

export interface DriftTotals {
  total_proposals: number;
  by_risk: Record<Risk, number>;
  by_kind: { remediation: number; question: number };
  instances_ok: number;
  instances_failed: number;
}

export interface DriftReport {
  generated_at: string;
  instances: Record<string, InstanceSection>;
  totals: DriftTotals;
  delta: DriftDelta;
}

export type AuditFn = (instance: CoolifyInstance) => Promise<AuditResult>;

/**
 * Stable identity for a proposal across runs. The proposal `id` carries a random
 * suffix (nanoid8) so it cannot be compared directly; the prefix before the colon
 * is the remediation_key/rule_id, which together with the instance and target uuid
 * is stable for "the same deviation on the same resource".
 */
export function proposalIdentity(instance: string, p: Proposal): string {
  const ruleKey = p.id.split(':')[0];
  return `${instance}::${ruleKey}::${p.target.uuid}`;
}

function toDeltaItem(instance: string, identity: string, p: Proposal): DeltaItem {
  return { instance, identity, description: p.description, risk: p.risk, reasoning: p.reasoning };
}

function collectProposals(
  instances: Record<string, InstanceSection>,
): Map<string, { instance: string; proposal: Proposal }> {
  const m = new Map<string, { instance: string; proposal: Proposal }>();
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
export function diffProposals(
  prevInstances: Record<string, InstanceSection> | null,
  currInstances: Record<string, InstanceSection>,
): DriftDelta {
  const prevMap = collectProposals(prevInstances ?? {});
  const currMap = collectProposals(currInstances);

  const newItems: DeltaItem[] = [];
  const resolved: DeltaItem[] = [];
  let unchanged = 0;

  for (const [id, { instance, proposal }] of currMap) {
    if (prevMap.has(id)) unchanged++;
    else newItems.push(toDeltaItem(instance, id, proposal));
  }

  for (const [id, { instance, proposal }] of prevMap) {
    if (currMap.has(id)) continue;
    const sec = currInstances[instance];
    if (sec && sec.ok) resolved.push(toDeltaItem(instance, id, proposal));
    // instance not successfully audited this run → status unknown, omit from resolved
  }

  return { new: newItems, resolved, unchanged };
}

function computeTotals(instances: Record<string, InstanceSection>): DriftTotals {
  const by_risk: Record<Risk, number> = { safe: 0, caution: 0, destructive: 0 };
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
export async function buildDriftReport(
  instances: CoolifyInstance[],
  auditFn: AuditFn,
  prevReport: DriftReport | null,
  generatedAt: string,
): Promise<DriftReport> {
  const sections: Record<string, InstanceSection> = {};
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
    } catch (e) {
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

/**
 * True when at least one instance was audited cleanly (ok, with no read errors).
 * Used to gate the heartbeat: a run where every instance errored out (e.g. missing
 * tokens) must NOT look healthy just because it produced "0 deviations".
 */
export function wasCleanlyAudited(report: DriftReport): boolean {
  return Object.values(report.instances).some((s) => s.ok && !(s.errors && s.errors.length));
}

/** Deterministic human-readable summary for the daily email digest. */
export function renderMarkdown(report: DriftReport): string {
  const { totals, delta } = report;
  const lines: string[] = [];
  lines.push(`# Infra Standards Drift — ${report.generated_at}`);
  lines.push('');
  lines.push(
    `**${totals.total_proposals} deviation(s)** across ${totals.instances_ok} instance(s) ` +
      `(${totals.by_risk.safe} safe, ${totals.by_risk.caution} caution, ${totals.by_risk.destructive} destructive)` +
      (totals.instances_failed > 0 ? ` · ${totals.instances_failed} instance(s) unreachable` : ''),
  );
  lines.push('');

  // Per-instance status line
  for (const [inst, sec] of Object.entries(report.instances)) {
    if (!sec.ok) {
      lines.push(`- **${inst}:** ⚠️ unreachable — ${sec.error}`);
      continue;
    }
    const n = sec.summary?.total_proposals ?? 0;
    const partial = sec.errors?.length ? ` (partial: ${sec.errors.join('; ')})` : '';
    lines.push(`- **${inst}:** ${sec.standards_source} · ${n} deviation(s)${partial}`);
  }
  lines.push('');

  // Delta
  lines.push('## Changes since last run');
  lines.push(
    `- New: ${delta.new.length} · Resolved: ${delta.resolved.length} · Unchanged: ${delta.unchanged}`,
  );
  if (delta.new.length) {
    lines.push('');
    lines.push('**New:**');
    for (const d of delta.new) lines.push(`- [${d.instance}] ${d.description} _(${d.risk})_`);
  }
  if (delta.resolved.length) {
    lines.push('');
    lines.push('**Resolved:**');
    for (const d of delta.resolved) lines.push(`- [${d.instance}] ${d.description}`);
  }
  lines.push('');

  // Full current list grouped by instance
  lines.push('## All current deviations');
  for (const [inst, sec] of Object.entries(report.instances)) {
    if (!sec.ok) continue;
    const props = sec.proposals ?? [];
    lines.push('');
    lines.push(`### ${inst} (${props.length})`);
    if (!props.length) {
      lines.push('- _none — conforms_');
      continue;
    }
    for (const p of props) {
      const tag = p.kind === 'question' ? '❓' : `🔧 ${p.risk}`;
      lines.push(`- ${tag}: ${p.description}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
