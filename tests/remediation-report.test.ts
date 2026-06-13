import { describe, it, expect } from "vitest";
import { buildRemediationReport, type Escalation } from "../src/standards/remediation-report.js";
import type { ApplyResult } from "../src/standards/executor.js";

const applied: ApplyResult[] = [
  { proposal_id: "a1", target: { provider: "coolify", resource_type: "application", uuid: "u1", name: "app1" }, tool: "coolify_update_application", args: { uuid: "u1" }, status: "applied", detail: "ok" },
  { proposal_id: "a2", target: { provider: "coolify", resource_type: "application", uuid: "u2", name: "app2" }, tool: "coolify_update_application", args: { uuid: "u2" }, status: "skipped", detail: "already conformant" },
  { proposal_id: "a3", target: { provider: "coolify", resource_type: "application", uuid: "u3", name: "app3" }, tool: "coolify_update_application", args: { uuid: "u3" }, status: "failed", detail: "boom" },
];

const escalations: Escalation[] = [
  { proposal_id: "q1", target: { provider: "coolify", resource_type: "database", uuid: "db1", name: "pg1" }, risk: "safe", kind: "question", reasoning: "rule #572", plan: { generated_by: "sonnet", root_cause: "x", steps: ["s"], infraops_tools: [], risk: "caution", rollback: "r", cm_window_hint: "h" } },
];

describe("buildRemediationReport", () => {
  it("computes totals from applied results and escalations", () => {
    const r = buildRemediationReport({ generatedAt: "2026-06-13T07:00:00Z", sourceReport: "2026-06-13.json", applied, escalations, selfResolved: 2, runawayTripped: false });
    expect(r.schema_version).toBe(1);
    expect(r.totals).toEqual({ applied: 1, skipped: 1, failed: 1, escalated: 1, self_resolved: 2, runaway_tripped: false });
    expect(r.source_report).toBe("2026-06-13.json");
    expect(r.applied).toHaveLength(3);
    expect(r.escalations).toHaveLength(1);
  });
  it("carries the runaway flag through", () => {
    const r = buildRemediationReport({ generatedAt: "t", sourceReport: "s", applied: [], escalations, selfResolved: 0, runawayTripped: true });
    expect(r.totals.runaway_tripped).toBe(true);
  });
});
