import { describe, it, expect } from "vitest";
import { classifyLane, resolveRepo, buildHandoff } from "../src/standards/handoff-brief.js";

const hc = (path = "/api/health") => ({
  id: "coolify.enable_healthcheck:u1",
  target: { provider: "coolify", resource_type: "application", uuid: "u1", name: "alobar-quest/booking-system:main" },
  planned_action: { tool: "coolify_update_application", args: { health_check_path: path } },
} as any);

describe("classifyLane", () => {
  it("404 → app-conformance", () => expect(classifyLane({ status: 404, reason: "HTTP 404" })).toBe("app-conformance"));
  it("400 / 405 → app-conformance", () => {
    expect(classifyLane({ status: 400, reason: "" })).toBe("app-conformance");
    expect(classifyLane({ status: 405, reason: "" })).toBe("app-conformance");
  });
  it("timeout (null) → infra-config", () => expect(classifyLane({ status: null, reason: "AbortError" })).toBe("infra-config"));
  it("302 redirect / SSO → infra-config", () => expect(classifyLane({ status: 302, reason: "redirect" })).toBe("infra-config"));
  it("401/403 auth → infra-config", () => {
    expect(classifyLane({ status: 401, reason: "" })).toBe("infra-config");
    expect(classifyLane({ status: 403, reason: "" })).toBe("infra-config");
  });
  it("5xx server error → infra-config", () => expect(classifyLane({ status: 503, reason: "" })).toBe("infra-config"));
  it("undefined probe → infra-config", () => expect(classifyLane(undefined)).toBe("infra-config"));
});

describe("resolveRepo", () => {
  it("derives repo from owner/repo:branch", async () =>
    expect(await resolveRepo("alobar-quest/booking-system:main")).toEqual({ repo: "booking-system", confirmed: false }));
  it("UNCONFIRMED when no owner/repo structure", async () =>
    expect(await resolveRepo("just-a-name")).toEqual({ repo: null, confirmed: false }));
  it("confirms via app-brain lookup", async () =>
    expect(await resolveRepo("o/booking-system:main", { appBrainLookup: async () => true }))
      .toEqual({ repo: "booking-system", confirmed: true }));
  it("UNCONFIRMED when app-brain denies", async () =>
    expect(await resolveRepo("o/booking-system:main", { appBrainLookup: async () => false }))
      .toEqual({ repo: null, confirmed: false }));
});

describe("buildHandoff", () => {
  it("app path mismatch → app-conformance with a brief naming repo, gap, acceptance", async () => {
    const out = await buildHandoff(hc(), { status: 404, reason: "HTTP 404" },
      "https://booking.devonwatkins.com/api/health", "prod");
    expect(out.lane).toBe("app-conformance");
    expect(out.handoff_brief).toContain("booking-system");
    expect(out.handoff_brief).toContain("/api/health");
    expect(out.handoff_brief).toContain("Acceptance check");
    expect(out.handoff_brief).toContain("Do-nots");
  });
  it("timeout → infra-config, no brief", async () => {
    const out = await buildHandoff(hc(), { status: null, reason: "AbortError" }, undefined, "prod");
    expect(out.lane).toBe("infra-config");
    expect(out.handoff_brief).toBeUndefined();
  });
  it("UNCONFIRMED repo when name has no owner/repo", async () => {
    const p = hc(); p.target.name = "mystery-app";
    const out = await buildHandoff(p, { status: 404, reason: "HTTP 404" }, "https://x/api/health", "prod");
    expect(out.lane).toBe("app-conformance");
    expect(out.handoff_brief).toContain("UNCONFIRMED");
  });
});
