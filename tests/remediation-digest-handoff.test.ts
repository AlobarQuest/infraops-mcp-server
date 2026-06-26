// tests/remediation-digest-handoff.test.ts
import { describe, it, expect } from "vitest";
import { renderRemediationMarkdown, type RemediationReport } from "../src/standards/remediation-report.js";

const report = (): RemediationReport => ({
  schema_version: 2, generated_at: "2026-06-26", source_report: "r.json",
  totals: { applied: 0, skipped: 0, failed: 0, escalated: 1, self_resolved: 0, runaway_tripped: false },
  applied: [],
  escalations: [{
    proposal_id: "coolify.enable_healthcheck:u1", instance: "prod",
    target: { provider: "coolify", resource_type: "application", uuid: "u1", name: "alobar-quest/booking-system:main" },
    risk: "safe", kind: "remediation", reasoning: "health check missing",
    plan: { generated_by: "t", root_cause: "x", steps: ["s"], infraops_tools: [], risk: "caution", rollback: "r", cm_window_hint: "h" },
    lane: "app-conformance", handoff_brief: "# Handoff brief: booking-system\nadd /api/health",
  }],
});

describe("renderRemediationMarkdown handoff section", () => {
  it("flags needs-handoff and embeds the brief", () => {
    const md = renderRemediationMarkdown(report());
    expect(md).toContain("Needs handoff");
    expect(md).toContain("booking-system");
    expect(md).toContain("add /api/health");
  });
});
