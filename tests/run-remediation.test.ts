import { describe, it, expect, vi } from "vitest";
import { runRemediation, type RemediationDeps } from "../src/standards/run-remediation.js";
import type { AuditResult } from "../src/standards/run-audit.js";
import type { Proposal, Risk } from "../src/standards/check-engine.js";
import type { ApplyResult } from "../src/standards/executor.js";
import type { RemediationPlan } from "../src/standards/remediation-plan.js";
import type { DriftReport } from "../src/standards/report.js";

let n = 0;
function prop(ruleKey: string, uuid: string, opts: Partial<Proposal> = {}): Proposal {
  return {
    id: `${ruleKey}:${(n++).toString(16).padStart(8, "0")}`,
    kind: "remediation",
    source: "standards-audit",
    status: "pending",
    target: { provider: "coolify", resource_type: "application", uuid, name: `name-${uuid}` },
    description: `App '${uuid}' violates ${ruleKey}`,
    reasoning: `infra-brain rule ${ruleKey}`,
    confidence: "high",
    risk: "safe" as Risk,
    planned_action: { tool: "coolify_update_application", args: { uuid, health_check_enabled: true } },
    question: null,
    ...opts,
  };
}

function auditResult(proposals: Proposal[]): AuditResult {
  return {
    meta: { standards_source: "live", checks_evaluated: 1, not_audited: 0 },
    summary: { total_proposals: proposals.length, by_risk: { safe: 0, caution: 0, destructive: 0 }, by_kind: { remediation: 0, question: 0 } },
    proposals,
  };
}

const appliedOk = (p: Proposal): ApplyResult => ({ proposal_id: p.id, target: p.target, tool: "coolify_update_application", args: p.planned_action!.args, status: "applied", detail: "ok" });
const plan = (): RemediationPlan => ({ generated_by: "sonnet", root_cause: "x", steps: ["s"], infraops_tools: [], risk: "caution", rollback: "r", cm_window_hint: "h" });

function deps(over: Partial<RemediationDeps> = {}): RemediationDeps {
  return {
    audit: vi.fn(async () => auditResult([])),
    apply: vi.fn(async (p: Proposal) => appliedOk(p)),
    plan: vi.fn(async () => plan()),
    verify: vi.fn(async () => ({ ok: true, reason: "ok" })),
    maxAutoApplies: 20,
    dryRun: false,
    ...over,
  };
}

describe("runRemediation", () => {
  it("applies safe proposals and escalates questions", async () => {
    const safe = prop("570", "u1");
    const question = prop("572", "u2", { kind: "question", planned_action: null, question: "fix?" });
    const d = deps({ audit: vi.fn(async () => auditResult([safe, question])) });
    const { report, cleanlyAudited } = await runRemediation(["prod"], null, "2026-06-13T07:00:00Z", "2026-06-13.json", d);
    expect(cleanlyAudited).toBe(true);
    expect(report.totals.applied).toBe(1);
    expect(report.totals.escalated).toBe(1);
    expect(d.apply).toHaveBeenCalledTimes(1);
    expect(d.plan).toHaveBeenCalledTimes(1);
    // contract v2: escalations carry their instance
    expect(report.escalations[0].instance).toBe("prod");
  });

  it("escalates a safe proposal that fails verify; applies the one that passes", async () => {
    const ok = prop("570", "u1");
    const held = prop("570", "u2");
    const verify = vi.fn(async (p: Proposal) => ({ ok: p.target.uuid === "u1", reason: p.target.uuid === "u1" ? "healthy" : "not running:healthy" }));
    const d = deps({ audit: vi.fn(async () => auditResult([ok, held])), verify });
    const { report } = await runRemediation(["prod"], null, "t", "s", d);
    expect(report.totals.applied).toBe(1);
    expect(report.totals.escalated).toBe(1);
    expect(d.apply).toHaveBeenCalledTimes(1);
    // the applied one is u1; the held one (u2) is escalated and carries a note
    expect(report.applied[0].target.uuid).toBe("u1");
    const heldEsc = report.escalations.find((e) => e.target.uuid === "u2");
    expect(heldEsc).toBeTruthy();
    expect(heldEsc!.note).toMatch(/not running:healthy/i);
  });

  it("does not run verify on the runaway path (everything escalates regardless)", async () => {
    const many = [prop("570", "u1"), prop("570", "u2"), prop("570", "u3")];
    const verify = vi.fn(async () => ({ ok: true, reason: "ok" }));
    const d = deps({ audit: vi.fn(async () => auditResult(many)), maxAutoApplies: 2, verify });
    const { report } = await runRemediation(["prod"], null, "t", "s", d);
    expect(report.totals.runaway_tripped).toBe(true);
    expect(report.totals.applied).toBe(0);
    expect(verify).not.toHaveBeenCalled();
  });

  it("trips the runaway guard: applies nothing, escalates all safe", async () => {
    const many = [prop("570", "u1"), prop("570", "u2"), prop("570", "u3")];
    const d = deps({ audit: vi.fn(async () => auditResult(many)), maxAutoApplies: 2 });
    const { report } = await runRemediation(["prod"], null, "t", "s", d);
    expect(report.totals.runaway_tripped).toBe(true);
    expect(report.totals.applied).toBe(0);
    expect(report.totals.escalated).toBe(3);
    expect(d.apply).not.toHaveBeenCalled();
  });

  it("counts self-resolved: in the morning report but no longer live", async () => {
    const stillLive = prop("570", "u1");
    const morning: DriftReport = {
      generated_at: "earlier",
      instances: { prod: { ok: true, proposals: [stillLive, prop("571", "GONE")] } },
      totals: { total_proposals: 2, by_risk: { safe: 2, caution: 0, destructive: 0 }, by_kind: { remediation: 2, question: 0 }, instances_ok: 1, instances_failed: 0 },
      delta: { new: [], resolved: [], unchanged: 0 },
    };
    const d = deps({ audit: vi.fn(async () => auditResult([stillLive])) });
    const { report } = await runRemediation(["prod"], morning, "t", "s", d);
    expect(report.totals.self_resolved).toBe(1);
  });

  it("a thrown audit for an instance does not abort the run; cleanlyAudited reflects the others", async () => {
    const audit = vi.fn(async (inst: string) => {
      if (inst === "dev") throw new Error("unreachable");
      return auditResult([prop("570", "u1")]);
    });
    const { report, cleanlyAudited } = await runRemediation(["prod", "dev"], null, "t", "s", deps({ audit }));
    expect(cleanlyAudited).toBe(true);
    expect(report.totals.applied).toBe(1);
  });

  it("cleanlyAudited is false when every instance throws", async () => {
    const audit = vi.fn(async () => { throw new Error("down"); });
    const { cleanlyAudited } = await runRemediation(["prod"], null, "t", "s", deps({ audit }));
    expect(cleanlyAudited).toBe(false);
  });

  it("passes dryRun through to apply", async () => {
    const apply = vi.fn(async (p: Proposal) => ({ ...appliedOk(p), status: "skipped" as const, detail: "dry-run" }));
    const d = deps({ audit: vi.fn(async () => auditResult([prop("570", "u1")])), apply, dryRun: true });
    await runRemediation(["prod"], null, "t", "s", d);
    expect(apply).toHaveBeenCalledWith(expect.anything(), "prod", { dryRun: true });
  });
});
