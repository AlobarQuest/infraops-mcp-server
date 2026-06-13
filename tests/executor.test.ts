import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

const { coolifyGet, coolifyPatch } = vi.hoisted(() => ({
  coolifyGet: vi.fn(),
  coolifyPatch: vi.fn(),
}));

vi.mock("../src/services/coolify-client.js", () => ({
  coolifyGet,
  coolifyPatch,
}));

import { wouldChange, isAutoApplicable, applyAction, maxAutoApplies, verifySafe } from "../src/standards/executor.js";
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

describe("applyAction", () => {
  beforeEach(() => {
    coolifyGet.mockReset();
    coolifyPatch.mockReset();
  });

  it("applies a drifted safe remediation: one PATCH with the args minus uuid", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", health_check_enabled: false });
    coolifyPatch.mockResolvedValue({});
    const res = await applyAction(makeProposal(), "prod");
    expect(res.status).toBe("applied");
    expect(coolifyPatch).toHaveBeenCalledTimes(1);
    expect(coolifyPatch).toHaveBeenCalledWith("/applications/u1", { health_check_enabled: true }, "prod");
  });

  it("skips (no PATCH) when the resource already conforms — idempotent", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", health_check_enabled: true });
    const res = await applyAction(makeProposal(), "prod");
    expect(res.status).toBe("skipped");
    expect(coolifyPatch).not.toHaveBeenCalled();
  });

  it("dry-run previews without PATCHing even when drifted", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", health_check_enabled: false });
    const res = await applyAction(makeProposal(), "prod", { dryRun: true });
    expect(res.status).toBe("skipped");
    expect(res.detail).toMatch(/dry-run/i);
    expect(coolifyPatch).not.toHaveBeenCalled();
  });

  it("records failed (no throw) when the client errors, leaving the batch to continue", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", health_check_enabled: false });
    coolifyPatch.mockRejectedValue(new Error("boom"));
    const res = await applyAction(makeProposal(), "prod");
    expect(res.status).toBe("failed");
    expect(res.detail).toContain("boom");
  });

  it("refuses (failed, no fetch) a non-auto-applicable proposal as defense in depth", async () => {
    const res = await applyAction(makeProposal({ risk: "destructive" }), "prod");
    expect(res.status).toBe("failed");
    expect(coolifyGet).not.toHaveBeenCalled();
    expect(coolifyPatch).not.toHaveBeenCalled();
  });
});

describe("maxAutoApplies", () => {
  const orig = process.env.MAX_AUTO_APPLIES;
  beforeEach(() => { delete process.env.MAX_AUTO_APPLIES; });
  afterAll(() => { if (orig !== undefined) process.env.MAX_AUTO_APPLIES = orig; });

  it("defaults to 20", () => { expect(maxAutoApplies()).toBe(20); });
  it("reads a positive integer from env", () => {
    process.env.MAX_AUTO_APPLIES = "5";
    expect(maxAutoApplies()).toBe(5);
  });
  it("falls back to 20 on a non-numeric env value", () => {
    process.env.MAX_AUTO_APPLIES = "nonsense";
    expect(maxAutoApplies()).toBe(20);
  });
});

describe("verifySafe", () => {
  beforeEach(() => { coolifyGet.mockReset(); });

  it("passes an enable_healthcheck when the app is running:healthy", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", status: "running:healthy" });
    const r = await verifySafe(makeProposal(), "prod");
    expect(r.ok).toBe(true);
  });

  it("fails (→ escalate) an enable_healthcheck when the app is running:unhealthy", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", status: "running:unhealthy" });
    expect((await verifySafe(makeProposal(), "prod")).ok).toBe(false);
  });

  it("fails (→ escalate) an enable_healthcheck when the app is running:unknown", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", status: "running:unknown" });
    expect((await verifySafe(makeProposal(), "prod")).ok).toBe(false);
  });

  it("does not gate a non-enable_healthcheck remediation (returns ok, no fetch)", async () => {
    const r = await verifySafe(makeProposal({ id: "coolify.something_else:abc123" }), "prod");
    expect(r.ok).toBe(true);
    expect(coolifyGet).not.toHaveBeenCalled();
  });

  it("fails closed when the live status fetch throws", async () => {
    coolifyGet.mockRejectedValue(new Error("boom"));
    expect((await verifySafe(makeProposal(), "prod")).ok).toBe(false);
  });
});
