import { describe, it, expect } from "vitest";
import { wouldChange, isAutoApplicable } from "../src/standards/executor.js";
import type { Proposal } from "../src/standards/check-engine.js";

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "coolify.enable_healthcheck:deadbeef",
    kind: "remediation",
    source: "standards-audit",
    status: "pending",
    target: { provider: "coolify", resource_type: "application", uuid: "u1", name: "app1" },
    description: "App 'app1' violates standard",
    reasoning: "infra-brain rule #570",
    confidence: "high",
    risk: "safe",
    planned_action: { tool: "coolify_update_application", args: { uuid: "u1", health_check_enabled: true } },
    question: null,
    ...overrides,
  };
}

describe("wouldChange", () => {
  it("returns true when a non-uuid arg differs from current state", () => {
    expect(wouldChange({ uuid: "u1", health_check_enabled: false }, { uuid: "u1", health_check_enabled: true })).toBe(true);
  });
  it("returns false when all non-uuid args already match (idempotent no-op)", () => {
    expect(wouldChange({ uuid: "u1", health_check_enabled: true, extra: "x" }, { uuid: "u1", health_check_enabled: true })).toBe(false);
  });
  it("ignores the uuid field when comparing", () => {
    expect(wouldChange({ uuid: "DIFFERENT", health_check_enabled: true }, { uuid: "u1", health_check_enabled: true })).toBe(false);
  });
});

describe("isAutoApplicable", () => {
  it("accepts a safe, high-confidence remediation whose tool is whitelisted", () => {
    expect(isAutoApplicable(makeProposal())).toBe(true);
  });
  it("rejects caution risk", () => {
    expect(isAutoApplicable(makeProposal({ risk: "caution" }))).toBe(false);
  });
  it("rejects destructive risk", () => {
    expect(isAutoApplicable(makeProposal({ risk: "destructive" }))).toBe(false);
  });
  it("rejects non-high confidence", () => {
    expect(isAutoApplicable(makeProposal({ confidence: "medium" }))).toBe(false);
  });
  it("rejects kind=question", () => {
    expect(isAutoApplicable(makeProposal({ kind: "question", planned_action: null }))).toBe(false);
  });
  it("rejects a null planned_action", () => {
    expect(isAutoApplicable(makeProposal({ planned_action: null }))).toBe(false);
  });
  it("rejects a tool that is not in SAFE_TOOLS", () => {
    expect(isAutoApplicable(makeProposal({ planned_action: { tool: "coolify_delete_application", args: { uuid: "u1" } } }))).toBe(false);
  });
});
