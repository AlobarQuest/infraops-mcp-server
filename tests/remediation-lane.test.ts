import { describe, it, expect } from "vitest";
import { laneFor } from "../src/standards/remediation-registry.js";

describe("laneFor (registry lane seam)", () => {
  it("defaults to infra-config for the health-check remediation", () => {
    expect(laneFor("coolify.enable_healthcheck")).toBe("infra-config");
  });
  it("defaults to infra-config for an unknown key", () => {
    expect(laneFor("nope.unknown")).toBe("infra-config");
  });
});
