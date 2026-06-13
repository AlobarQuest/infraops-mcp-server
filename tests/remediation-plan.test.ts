import { describe, it, expect } from "vitest";
import { buildPlanPrompt, rawFallback, RemediationPlanSchema, planEscalation } from "../src/standards/remediation-plan.js";
import type { Proposal } from "../src/standards/check-engine.js";

function questionProposal(): Proposal {
  return {
    id: "572:e4f2022e",
    kind: "question",
    source: "standards-audit",
    status: "pending",
    target: { provider: "coolify", resource_type: "database", uuid: "db1", name: "agent-sites-postgres" },
    description: "Database 'agent-sites-postgres' violates standard: backups must be defined.",
    reasoning: "infra-brain rule #572 (WARN): databases must have backups.",
    confidence: "high",
    risk: "safe",
    planned_action: null,
    question: "Database 'agent-sites-postgres' violates standard. Review and fix manually?",
  };
}

describe("buildPlanPrompt", () => {
  it("includes the resource name, the violated rule reasoning, and the description", () => {
    const prompt = buildPlanPrompt(questionProposal());
    expect(prompt).toContain("agent-sites-postgres");
    expect(prompt).toContain("rule #572");
    expect(prompt).toContain("backups must be defined");
  });
  it("is deterministic (no timestamps / randomness)", () => {
    expect(buildPlanPrompt(questionProposal())).toBe(buildPlanPrompt(questionProposal()));
  });
});

describe("rawFallback", () => {
  it("produces a schema-valid plan tagged generated_by=raw from the proposal alone", () => {
    const plan = rawFallback(questionProposal());
    expect(plan.generated_by).toBe("raw");
    expect(() => RemediationPlanSchema.parse(plan)).not.toThrow();
    expect(plan.root_cause).toContain("rule #572");
  });
});

function fakeClient(impl: () => Promise<unknown>) {
  return { messages: { parse: impl } } as unknown as import("@anthropic-ai/sdk").default;
}

describe("planEscalation", () => {
  it("returns a sonnet-tagged plan when the model responds with valid structured output", async () => {
    const client = fakeClient(async () => ({
      parsed_output: {
        root_cause: "No backup schedule configured.",
        steps: ["Create a nightly backup scheduled task."],
        infraops_tools: ["coolify_create_scheduled_task"],
        risk: "caution",
        rollback: "Delete the scheduled task.",
        cm_window_hint: "Off-peak; additive and non-disruptive.",
      },
    }));
    const plan = await planEscalation(questionProposal(), client);
    expect(plan.generated_by).toBe("sonnet");
    expect(plan.infraops_tools).toContain("coolify_create_scheduled_task");
  });

  it("falls back to raw when parsed_output is null", async () => {
    const client = fakeClient(async () => ({ parsed_output: null }));
    const plan = await planEscalation(questionProposal(), client);
    expect(plan.generated_by).toBe("raw");
  });

  it("falls back to raw (never throws) when the API call rejects", async () => {
    const client = fakeClient(async () => { throw new Error("api down"); });
    const plan = await planEscalation(questionProposal(), client);
    expect(plan.generated_by).toBe("raw");
  });
});
