import { describe, it, expect, vi } from "vitest";
import { verifySafe } from "../src/standards/executor.js";

const hcProposal = () => ({
  id: "coolify.enable_healthcheck:u1",
  target: { provider: "coolify", resource_type: "application", uuid: "u1", name: "o/app1:main" },
  planned_action: { tool: "coolify_update_application", args: { health_check_path: "/api/health" } },
} as any);

describe("verifySafe surfaces probe + url on a non-2xx hold", () => {
  it("returns the ProbeResult and the probed URL when held", async () => {
    const get = vi.fn().mockResolvedValue({ uuid: "u1", fqdn: "https://app1.devonwatkins.com" });
    const r = await verifySafe(hcProposal(), "prod" as any, {
      get: get as any,
      probe: async () => ({ status: 404, reason: "HTTP 404" }),
    });
    expect(r.ok).toBe(false);
    expect(r.probe).toEqual({ status: 404, reason: "HTTP 404" });
    expect(r.url).toBe("https://app1.devonwatkins.com/api/health");
  });
});
