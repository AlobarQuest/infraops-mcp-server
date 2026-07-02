import { vi, describe, it, expect, beforeEach } from "vitest";

const { coolifyGet, coolifyPatch, coolifyPost } = vi.hoisted(() => ({
  coolifyGet: vi.fn(),
  coolifyPatch: vi.fn(),
  coolifyPost: vi.fn(),
}));
vi.mock("../src/services/coolify-client.js", () => ({ coolifyGet, coolifyPatch, coolifyPost }));

import { runChangeAgent } from "../src/change-manager/agent.js";
import type { ApprovedItem } from "../src/change-manager/api-client.js";

beforeEach(() => { coolifyGet.mockReset(); coolifyPatch.mockReset(); coolifyPost.mockReset(); });

function item(): ApprovedItem {
  return { id: 1, identity: "prod::coolify.force_https::u1", instance: "prod", rule_key: "coolify.force_https",
    resource_type: "application", resource_uuid: "u1", resource_name: "mirror",
    risk: "caution", kind: "remediation", reasoning: "must be https", plan: { steps: ["set https", "redeploy"] },
    note: null, status: "in_progress" };
}

// A fake Anthropic client whose .messages.create returns a scripted sequence of turns.
function fakeAnthropic(turns: any[]) {
  let i = 0;
  return { messages: { create: vi.fn(async () => turns[i++]) } } as any;
}

const textTurn = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const toolTurn = (name: string, input: any) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name, input }] });

describe("runChangeAgent", () => {
  it("runs tool calls then report_done → outcome done (post-verify passes) with tool_calls recorded", async () => {
    // Stateful Coolify: starts http; the domains PATCH flips it to https so post-verify passes.
    let domains = "http://x.com";
    coolifyGet.mockImplementation(async () => ({ uuid: "u1", domains, fqdn: domains }));
    coolifyPatch.mockImplementation(async (_p: string, body: any) => { if (body?.domains) domains = body.domains; return {}; });
    coolifyPost.mockResolvedValue({});
    const client = fakeAnthropic([
      toolTurn("set_application_domains", { uuid: "u1", domains: "https://x.com" }),
      toolTurn("redeploy_application", { uuid: "u1" }),
      toolTurn("report_done", { summary: "https enabled + redeployed" }),
    ]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("done");
    expect(out.detail).toMatch(/https enabled/);
    expect(out.rollback.domains).toBe("http://x.com");
    expect(out.tool_calls.calls.length).toBe(3);
  });

  it("already-conformant HTTPS item → skipped_conformant before any write", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", domains: "https://x.com", fqdn: "https://x.com" });
    const create = vi.fn();
    const client = { messages: { create } } as any;
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("skipped_conformant");
    expect(create).not.toHaveBeenCalled();         // agent loop never ran
    expect(coolifyPatch).not.toHaveBeenCalled();    // nothing written
  });

  it("post-verify failure → revert + failed (agent claims done but domains still http)", async () => {
    // coolifyGet always returns http (the change never actually took); patch is a no-op.
    coolifyGet.mockResolvedValue({ uuid: "u1", domains: "http://x.com", fqdn: "http://x.com" });
    coolifyPatch.mockResolvedValue({}); coolifyPost.mockResolvedValue({});
    const client = fakeAnthropic([
      toolTurn("set_application_domains", { uuid: "u1", domains: "https://x.com" }),
      toolTurn("report_done", { summary: "claims done" }),
    ]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("failed");
    expect(out.detail).toMatch(/post-verify/i);
    // revert PATCHed domains back to the captured original
    expect(coolifyPatch).toHaveBeenCalledWith("/applications/u1",
      { domains: "http://x.com", force_domain_override: true }, "prod");
  });

  it("report_blocked → outcome blocked with reason", async () => {
    coolifyGet.mockResolvedValue(undefined);  // pre-validate can't confirm conformance → proceeds to the loop
    const client = fakeAnthropic([toolTurn("report_blocked", { reason: "no health endpoint" })]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("blocked");
    expect(out.detail).toMatch(/no health endpoint/);
  });

  it("hitting maxSteps without a report → failed", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", domains: "http://x.com" });
    const client = fakeAnthropic(Array(20).fill(toolTurn("get_application", { uuid: "u1" })));
    const out = await runChangeAgent(item(), { client, maxSteps: 3 });
    expect(out.outcome).toBe("failed");
  });

  it("a tool error → failed (never throws)", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", domains: "http://x.com" });
    coolifyPatch.mockRejectedValue(new Error("boom"));
    const client = fakeAnthropic([
      toolTurn("set_application_domains", { uuid: "u1", domains: "https://x.com" }),
      toolTurn("report_done", { summary: "done" }),
    ]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    // the tool error is fed back to the model as a tool_result error; the recorded tool_calls capture it.
    expect(out.tool_calls.calls.some((c: any) => /boom/.test(JSON.stringify(c)))).toBe(true);
  });

  it("a turn with no tool_use → failed (no completion signal)", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", domains: "http://x.com", fqdn: "http://x.com" });
    const client = fakeAnthropic([textTurn("I think this is fine, doing nothing.")]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("failed");
    expect(out.detail).toMatch(/without report/i);
  });

  it("handles two tool_use blocks in one turn (set_domains + redeploy), then done", async () => {
    // Two write blocks in one turn (the multi-block path under test). The mocked
    // coolifyGet returns the app object for /deployments too (no `.deployments`),
    // so post-verify's deployment poll is `unknown` → conservatively keeps `done`
    // without a live cert probe. A domain change now REQUIRES a redeploy call
    // (BACKLOG #5): set-domains-then-done with no redeploy is a `failed`, by design.
    let domains = "http://x.com";
    coolifyGet.mockImplementation(async () => ({ uuid: "u1", domains, fqdn: domains }));
    coolifyPatch.mockImplementation(async (_p: string, body: any) => { if (body?.domains) domains = body.domains; return {}; });
    coolifyPost.mockResolvedValue({});
    const twoBlockTurn = {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "a", name: "set_application_domains", input: { uuid: "u1", domains: "https://x.com" } },
        { type: "tool_use", id: "b", name: "redeploy_application", input: { uuid: "u1" } },
      ],
    };
    const client = fakeAnthropic([twoBlockTurn, toolTurn("report_done", { summary: "done" })]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("done");
    expect(out.tool_calls.calls.map((c: any) => c.name)).toEqual(["set_application_domains", "redeploy_application", "report_done"]);
  });
});
