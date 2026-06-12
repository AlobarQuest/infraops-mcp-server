import { describe, it, expect } from "vitest";
import {
  proposalIdentity,
  diffProposals,
  buildDriftReport,
  renderMarkdown,
  wasCleanlyAudited,
  type InstanceSection,
  type DriftReport,
} from "../src/standards/report.js";
import type { Proposal, Risk } from "../src/standards/check-engine.js";
import type { AuditResult } from "../src/standards/run-audit.js";

let counter = 0;
function makeProposal(ruleKey: string, uuid: string, risk: Risk = "safe"): Proposal {
  // simulate the random id suffix the engine appends
  const suffix = (counter++).toString(16).padStart(8, "0");
  return {
    id: `${ruleKey}:${suffix}`,
    kind: risk === "safe" || risk === "caution" ? "remediation" : "remediation",
    source: "standards-audit",
    status: "pending",
    target: { provider: "coolify", resource_type: "application", uuid, name: `name-${uuid}` },
    description: `App '${uuid}' violates ${ruleKey}`,
    reasoning: `infra-brain rule #570 (WARN): ${ruleKey}`,
    confidence: "high",
    risk,
    planned_action: { tool: "coolify_update_application", args: { uuid } },
    question: null,
  };
}

function okSection(proposals: Proposal[]): InstanceSection {
  return { ok: true, standards_source: "live", summary: { total_proposals: proposals.length, by_risk: { safe: 0, caution: 0, destructive: 0 }, by_kind: { remediation: 0, question: 0 } }, proposals };
}

function auditResult(proposals: Proposal[], source: AuditResult["meta"]["standards_source"] = "live", errors?: string[]): AuditResult {
  return {
    meta: { standards_source: source, checks_evaluated: 3, not_audited: 0, ...(errors ? { errors } : {}) },
    summary: { total_proposals: proposals.length, by_risk: { safe: 0, caution: 0, destructive: 0 }, by_kind: { remediation: 0, question: 0 } },
    proposals,
  };
}

describe("proposalIdentity", () => {
  it("is stable across the random id suffix", () => {
    const a = makeProposal("coolify.enable_healthcheck", "app-1");
    const b = makeProposal("coolify.enable_healthcheck", "app-1");
    expect(a.id).not.toBe(b.id); // different random suffixes
    expect(proposalIdentity("prod", a)).toBe(proposalIdentity("prod", b));
  });

  it("differs by instance, rule, and target uuid", () => {
    const p = makeProposal("coolify.enable_healthcheck", "app-1");
    const q = makeProposal("coolify.force_https", "app-1");
    const r = makeProposal("coolify.enable_healthcheck", "app-2");
    expect(proposalIdentity("prod", p)).not.toBe(proposalIdentity("dev", p));
    expect(proposalIdentity("prod", p)).not.toBe(proposalIdentity("prod", q));
    expect(proposalIdentity("prod", p)).not.toBe(proposalIdentity("prod", r));
  });
});

describe("diffProposals", () => {
  it("classifies new, resolved, and unchanged", () => {
    const shared = makeProposal("coolify.enable_healthcheck", "app-1");
    const sharedNextRun = makeProposal("coolify.enable_healthcheck", "app-1"); // same identity, new id
    const gone = makeProposal("coolify.force_https", "app-2");
    const fresh = makeProposal("coolify.enable_healthcheck", "app-3");

    const prev = { prod: okSection([shared, gone]) };
    const curr = { prod: okSection([sharedNextRun, fresh]) };

    const delta = diffProposals(prev, curr);
    expect(delta.unchanged).toBe(1);
    expect(delta.new.map((d) => d.identity)).toEqual([proposalIdentity("prod", fresh)]);
    expect(delta.resolved.map((d) => d.identity)).toEqual([proposalIdentity("prod", gone)]);
  });

  it("treats everything as new when there is no previous report", () => {
    const curr = { prod: okSection([makeProposal("coolify.enable_healthcheck", "app-1")]) };
    const delta = diffProposals(null, curr);
    expect(delta.new).toHaveLength(1);
    expect(delta.resolved).toHaveLength(0);
    expect(delta.unchanged).toBe(0);
  });

  it("does NOT mark prior deviations resolved when the instance is unreachable now", () => {
    const wasThere = makeProposal("coolify.enable_healthcheck", "dev-app");
    const prev = { dev: okSection([wasThere]) };
    // dev failed to audit this run
    const curr: Record<string, InstanceSection> = { dev: { ok: false, error: "dev unreachable" } };

    const delta = diffProposals(prev, curr);
    expect(delta.resolved).toHaveLength(0); // unknown, not resolved
    expect(delta.new).toHaveLength(0);
  });
});

describe("buildDriftReport", () => {
  it("assembles ok sections and computes totals + delta", async () => {
    const p1 = makeProposal("coolify.enable_healthcheck", "app-1", "safe");
    const p2 = makeProposal("coolify.force_https", "app-1", "caution");
    const auditFn = async (inst: string) => (inst === "prod" ? auditResult([p1, p2]) : auditResult([]));

    const report = await buildDriftReport(["prod", "dev"], auditFn as any, null, "2026-06-13T07:00:00Z");

    expect(report.instances.prod.ok).toBe(true);
    expect(report.instances.dev.ok).toBe(true);
    expect(report.totals.total_proposals).toBe(2);
    expect(report.totals.by_risk.caution).toBe(1);
    expect(report.totals.instances_ok).toBe(2);
    expect(report.delta.new).toHaveLength(2);
  });

  it("isolates a throwing instance into an error section without aborting others", async () => {
    const p1 = makeProposal("coolify.enable_healthcheck", "app-1");
    const auditFn = async (inst: string) => {
      if (inst === "dev") throw new Error("dev unreachable");
      return auditResult([p1]);
    };

    const report = await buildDriftReport(["prod", "dev"], auditFn as any, null, "2026-06-13T07:00:00Z");

    expect(report.instances.prod.ok).toBe(true);
    expect(report.instances.dev.ok).toBe(false);
    expect(report.instances.dev.error).toContain("dev unreachable");
    expect(report.totals.instances_failed).toBe(1);
    expect(report.totals.instances_ok).toBe(1);
  });

  it("propagates per-endpoint errors into the section", async () => {
    const auditFn = async () => auditResult([], "live", ["databases: boom"]);
    const report = await buildDriftReport(["prod"], auditFn as any, null, "2026-06-13T07:00:00Z");
    expect(report.instances.prod.errors).toEqual(["databases: boom"]);
  });
});

describe("wasCleanlyAudited", () => {
  it("is true when an instance is ok with no read errors", async () => {
    const report = await buildDriftReport(["prod"], (async () => auditResult([])) as any, null, "t");
    expect(wasCleanlyAudited(report)).toBe(true);
  });

  it("is false when every instance errored out (e.g. missing tokens)", async () => {
    const auditFn = async () => auditResult([], "cache", ["applications: TOKEN required", "databases: TOKEN required"]);
    const report = await buildDriftReport(["prod", "dev"], auditFn as any, null, "t");
    expect(wasCleanlyAudited(report)).toBe(false);
  });

  it("is true when one instance is clean even if another is unreachable", async () => {
    const auditFn = async (inst: string) => {
      if (inst === "dev") throw new Error("offline");
      return auditResult([]);
    };
    const report = await buildDriftReport(["prod", "dev"], auditFn as any, null, "t");
    expect(wasCleanlyAudited(report)).toBe(true);
  });
});

describe("renderMarkdown", () => {
  it("includes totals, per-instance status, delta, and unreachable instances", async () => {
    const p1 = makeProposal("coolify.enable_healthcheck", "app-1", "safe");
    const report: DriftReport = await buildDriftReport(
      ["prod", "dev"],
      (async (inst: string) => {
        if (inst === "dev") throw new Error("dev offline");
        return auditResult([p1]);
      }) as any,
      null,
      "2026-06-13T07:00:00Z",
    );
    const md = renderMarkdown(report);
    expect(md).toContain("Infra Standards Drift — 2026-06-13T07:00:00Z");
    expect(md).toContain("**prod:** live · 1 deviation(s)");
    expect(md).toContain("⚠️ unreachable — dev offline");
    expect(md).toContain("## Changes since last run");
    expect(md).toContain("New: 1");
  });
});
