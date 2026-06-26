import type { ApplyResult } from "./executor.js";
import type { Proposal } from "./check-engine.js";
import type { RemediationPlan } from "./remediation-plan.js";

/** One escalated (non-auto-fixable) item plus its Sonnet/raw plan. The change-manager contract. */
export interface Escalation {
  proposal_id: string;
  instance: string; // 'prod' | 'dev' — which Coolify instance this came from (contract v2)
  target: Proposal["target"];
  risk: string;
  kind: string;
  reasoning: string;
  plan: RemediationPlan;
  /** Why this was escalated rather than auto-applied (e.g. a verify gate held it). Absent for inherently-escalated items. */
  note?: string;
  lane?: import("./remediation-registry.js").Lane;
  handoff?: import("./handoff-brief.js").HandoffPackage;
  handoff_brief?: string;
}

export interface RemediationReport {
  schema_version: number;
  generated_at: string;
  source_report: string;
  totals: {
    applied: number;
    skipped: number;
    failed: number;
    escalated: number;
    self_resolved: number;
    runaway_tripped: boolean;
  };
  applied: ApplyResult[];
  escalations: Escalation[];
}

export function buildRemediationReport(args: {
  generatedAt: string;
  sourceReport: string;
  applied: ApplyResult[];
  escalations: Escalation[];
  selfResolved: number;
  runawayTripped: boolean;
}): RemediationReport {
  const count = (s: ApplyResult["status"]) => args.applied.filter((a) => a.status === s).length;
  return {
    schema_version: 2,
    generated_at: args.generatedAt,
    source_report: args.sourceReport,
    totals: {
      applied: count("applied"),
      skipped: count("skipped"),
      failed: count("failed"),
      escalated: args.escalations.length,
      self_resolved: args.selfResolved,
      runaway_tripped: args.runawayTripped,
    },
    applied: args.applied,
    escalations: args.escalations,
  };
}

/** Human-readable digest for the daily consolidated email. */
export function renderRemediationMarkdown(r: RemediationReport): string {
  const t = r.totals;
  const lines: string[] = [];
  lines.push(`# Infra Remediation — ${r.generated_at}`);
  lines.push("");
  lines.push(
    `**${t.applied} fixed**, ${t.escalated} need attention ` +
      `(skipped ${t.skipped}, failed ${t.failed}, self-resolved ${t.self_resolved}).`,
  );
  if (t.runaway_tripped) {
    lines.push("");
    lines.push(
      `> ⚠️ **Safety guard tripped:** the live safe-fix count exceeded MAX_AUTO_APPLIES, ` +
        `so NOTHING was auto-applied — every item was escalated for review.`,
    );
  }
  lines.push("");

  lines.push("## Auto-applied");
  if (!r.applied.length) {
    lines.push("- _none_");
  } else {
    for (const a of r.applied) {
      const icon = a.status === "applied" ? "✅" : a.status === "skipped" ? "⏭️" : "❌";
      lines.push(`- ${icon} **${a.target.name}** (${a.tool}) — ${a.status}: ${a.detail}`);
    }
  }
  lines.push("");

  lines.push("## Escalated — needs review");
  if (!r.escalations.length) {
    lines.push("- _nothing needs your attention_");
  } else {
    for (const e of r.escalations) {
      lines.push("");
      lines.push(`### ${e.target.resource_type} '${e.target.name}' (${e.risk}) — Plan by ${e.plan.generated_by}`);
      if (e.note) lines.push(`- **Auto-fix held:** ${e.note}`);
      lines.push(`- **Why:** ${e.reasoning}`);
      lines.push(`- **Root cause:** ${e.plan.root_cause}`);
      lines.push(`- **Steps:**`);
      for (const s of e.plan.steps) lines.push(`  1. ${s}`);
      lines.push(`- **Tools:** ${e.plan.infraops_tools.join(", ") || "—"}`);
      lines.push(`- **Fix risk:** ${e.plan.risk} · **Rollback:** ${e.plan.rollback}`);
      lines.push(`- **Change window:** ${e.plan.cm_window_hint}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
