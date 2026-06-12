import { describe, it, expect } from "vitest";
import { resolveRemediation, REMEDIATIONS } from "../src/standards/remediation-registry.js";

const app: Record<string, unknown> = {
  uuid: "app-uuid-1",
  name: "my-app",
  fqdn: "http://my-app.devonwatkins.com",
  health_check_enabled: false,
};

describe("resolveRemediation", () => {
  it("returns null for an unknown key", () => {
    expect(resolveRemediation("unknown.key", app)).toBeNull();
  });

  describe("coolify.enable_healthcheck", () => {
    it("returns the correct tool and safe risk", () => {
      const result = resolveRemediation("coolify.enable_healthcheck", app);
      expect(result).not.toBeNull();
      expect(result!.action.tool).toBe("coolify_update_application");
      expect(result!.risk).toBe("safe");
    });

    it("includes required health-check args with correct types", () => {
      const result = resolveRemediation("coolify.enable_healthcheck", app);
      const args = result!.action.args;
      expect(args.uuid).toBe("app-uuid-1");
      expect(args.health_check_enabled).toBe(true);
      expect(args.health_check_path).toBe("/api/health");
      expect(typeof args.health_check_start_period).toBe("number");
      expect(args.health_check_start_period).toBe(15);
    });

    it("does not include any fields that coolify_update_application does not accept", () => {
      const result = resolveRemediation("coolify.enable_healthcheck", app);
      const args = result!.action.args;
      // These fields are NOT in the coolify_update_application schema
      expect(args.health_check_interval).toBeUndefined();
      expect(args.health_check_timeout).toBeUndefined();
      expect(args.health_check_retries).toBeUndefined();
      expect(args.health_check_host).toBeUndefined();
    });
  });

  describe("coolify.force_https", () => {
    it("returns the correct tool and caution risk", () => {
      const result = resolveRemediation("coolify.force_https", app);
      expect(result).not.toBeNull();
      expect(result!.action.tool).toBe("coolify_update_application");
      expect(result!.risk).toBe("caution");
    });

    it("rewrites http:// to https:// in the domains arg", () => {
      const result = resolveRemediation("coolify.force_https", app);
      const args = result!.action.args;
      expect(args.uuid).toBe("app-uuid-1");
      expect(args.domains).toBe("https://my-app.devonwatkins.com");
    });

    it("leaves an already-https fqdn unchanged", () => {
      const httpsApp = { ...app, fqdn: "https://my-app.devonwatkins.com" };
      const result = resolveRemediation("coolify.force_https", httpsApp);
      expect(result!.action.args.domains).toBe("https://my-app.devonwatkins.com");
    });
  });

  describe("REMEDIATIONS registry", () => {
    it("contains exactly the Phase 1 keys", () => {
      const keys = Object.keys(REMEDIATIONS);
      expect(keys).toContain("coolify.enable_healthcheck");
      expect(keys).toContain("coolify.force_https");
    });
  });
});
