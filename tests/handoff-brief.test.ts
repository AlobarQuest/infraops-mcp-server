import { describe, it, expect } from "vitest";
import { classifyLane, resolveRepo, buildHandoffPackage, renderHandoffBrief, buildHandoff, hostFromUrl } from "../src/standards/handoff-brief.js";

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

describe("buildHandoffPackage", () => {
  it("assembles the structured fields incl. target_branch and rule", () => {
    const p = buildHandoffPackage({ repo: "booking-system", targetBranch: "main", rule: "coolify.enable_healthcheck",
      path: "/api/health", url: "https://booking/api/health", probeReason: "HTTP 404" });
    expect(p.repo).toBe("booking-system");
    expect(p.target_branch).toBe("main");
    expect(p.rule).toBe("coolify.enable_healthcheck");
    expect(p.acceptance_check).toContain("https://booking/api/health");
    expect(Array.isArray(p.do_nots)).toBe(true);
    expect(p.do_nots.length).toBeGreaterThan(0);
  });
  it("uses UNCONFIRMED when repo is null", () => {
    const p = buildHandoffPackage({ repo: null, targetBranch: "main", rule: "r", path: "/api/health", url: null, probeReason: "HTTP 404" });
    expect(p.repo).toBe("UNCONFIRMED");
  });
});

describe("renderHandoffBrief", () => {
  it("renders all sections from the package", () => {
    const md = renderHandoffBrief({ repo: "booking-system", target_branch: "main", rule: "coolify.enable_healthcheck",
      verified_gap: "GET …/api/health → 404", required_change: "add /api/health", acceptance_check: "GET … 2xx",
      scope_guard: "app only", do_nots: ["x", "y"] });
    for (const s of ["Source", "Verified gap", "Required change", "Acceptance check", "Scope guard", "Do-nots"])
      expect(md).toContain(s);
    expect(md).toContain("booking-system");
    expect(md).toContain("main");
    expect(md).toContain("x");
  });
});

describe("hostFromUrl", () => {
  it("extracts lowercased hostname", () =>
    expect(hostFromUrl("https://Booking.DevonWatkins.com/api/health")).toBe("booking.devonwatkins.com"));
  it("drops a :port", () =>
    expect(hostFromUrl("https://booking.devonwatkins.com:8443/api/health")).toBe("booking.devonwatkins.com"));
  it("strips path / trailing slash", () =>
    expect(hostFromUrl("https://booking.devonwatkins.com/")).toBe("booking.devonwatkins.com"));
  it("rejects userinfo (credential spoofing) → null", () =>
    expect(hostFromUrl("https://user:pass@booking.devonwatkins.com/x")).toBeNull());
  it("rejects non-http scheme → null", () =>
    expect(hostFromUrl("file:///etc/passwd")).toBeNull());
  it("null / empty / garbage → null", () => {
    expect(hostFromUrl(null)).toBeNull();
    expect(hostFromUrl("")).toBeNull();
    expect(hostFromUrl("not a url")).toBeNull();
    expect(hostFromUrl("booking.devonwatkins.com, other.com")).toBeNull();
  });
});

describe("buildHandoff", () => {
  const hc = (path = "/api/health") => ({
    id: "coolify.enable_healthcheck:u1",
    target: { provider: "coolify", resource_type: "application", uuid: "u1", name: "alobar-quest/booking-system:main" },
    planned_action: { tool: "coolify_update_application", args: { health_check_path: path } },
  } as any);

  it("app path mismatch → structured handoff + rendered brief", async () => {
    const out = await buildHandoff(hc(), { status: 404, reason: "HTTP 404" }, "https://booking/api/health", "prod");
    expect(out.lane).toBe("app-conformance");
    expect(out.handoff?.repo).toBe("booking-system");
    expect(out.handoff?.target_branch).toBe("main");
    expect(out.handoff?.rule).toBe("coolify.enable_healthcheck");
    expect(out.handoff_brief).toContain("booking-system");
  });
  it("timeout → infra-config, no handoff, no brief", async () => {
    const out = await buildHandoff(hc(), { status: null, reason: "AbortError" }, undefined, "prod");
    expect(out.lane).toBe("infra-config");
    expect(out.handoff).toBeUndefined();
    expect(out.handoff_brief).toBeUndefined();
  });
  it("name without owner/repo → UNCONFIRMED repo in the package", async () => {
    const p = hc(); p.target.name = "mystery-app";
    const out = await buildHandoff(p, { status: 404, reason: "HTTP 404" }, "https://x/api/health", "prod");
    expect(out.handoff?.repo).toBe("UNCONFIRMED");
  });
});
