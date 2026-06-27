import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("axios", () => {
  const instance = { get: vi.fn() };
  const create = vi.fn(() => instance);
  return {
    default: { create, isAxiosError: vi.fn(), __mockInstance: instance },
    isAxiosError: vi.fn(),
    AxiosError: class AxiosError extends Error {},
    __mockInstance: instance,
  };
});

import axios from "axios";

const setEnv = () => {
  process.env.APPBRAIN_BASE_URL = "https://app-brain.devonwatkins.com";
  process.env.APPBRAIN_ACCESS_KEY = "secret-key-value";
};

describe("appbrain-client", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved.APPBRAIN_BASE_URL = process.env.APPBRAIN_BASE_URL;
    saved.APPBRAIN_ACCESS_KEY = process.env.APPBRAIN_ACCESS_KEY;
    vi.resetModules();
  });
  afterEach(() => {
    process.env.APPBRAIN_BASE_URL = saved.APPBRAIN_BASE_URL;
    process.env.APPBRAIN_ACCESS_KEY = saved.APPBRAIN_ACCESS_KEY;
    vi.restoreAllMocks();
  });

  describe("isAppbrainConfigured", () => {
    it("true when both env vars set", async () => {
      setEnv();
      const { isAppbrainConfigured } = await import("../src/services/appbrain-client.js");
      expect(isAppbrainConfigured()).toBe(true);
    });
    it("false when key missing", async () => {
      process.env.APPBRAIN_BASE_URL = "https://app-brain.devonwatkins.com";
      delete process.env.APPBRAIN_ACCESS_KEY;
      const { isAppbrainConfigured } = await import("../src/services/appbrain-client.js");
      expect(isAppbrainConfigured()).toBe(false);
    });
  });

  describe("validateResolution", () => {
    it("accepts a full booking body", async () => {
      const { validateResolution } = await import("../src/services/appbrain-client.js");
      expect(validateResolution({ github_repo: "AlobarQuest/booking-system", name: "prod", branch: "master", url: "https://booking.devonwatkins.com" }))
        .toEqual({ github_repo: "AlobarQuest/booking-system", name: "prod", branch: "master", url: "https://booking.devonwatkins.com" });
    });
    it("accepts null github_repo/branch/url (valid-but-incomplete)", async () => {
      const { validateResolution } = await import("../src/services/appbrain-client.js");
      expect(validateResolution({ github_repo: null, name: "prod", branch: null, url: null }))
        .toEqual({ github_repo: null, name: "prod", branch: null, url: null });
    });
    it("throws on wrong-typed branch", async () => {
      const { validateResolution } = await import("../src/services/appbrain-client.js");
      expect(() => validateResolution({ github_repo: "o/r", name: "prod", branch: 123, url: null })).toThrow();
    });
    it("throws on missing/empty name", async () => {
      const { validateResolution } = await import("../src/services/appbrain-client.js");
      expect(() => validateResolution({ github_repo: "o/r", name: "", branch: "master", url: null })).toThrow();
    });
    it("throws on non-object", async () => {
      const { validateResolution } = await import("../src/services/appbrain-client.js");
      expect(() => validateResolution(null)).toThrow();
    });
  });

  describe("resolveApp", () => {
    const mockGet = () => (axios as any).__mockInstance.get as ReturnType<typeof vi.fn>;
    it("200 → validated body; sends uuid param + x-brain-key header", async () => {
      setEnv();
      const { resolveApp } = await import("../src/services/appbrain-client.js");
      mockGet().mockResolvedValue({ status: 200, data: { github_repo: "AlobarQuest/booking-system", name: "prod", branch: "master", url: "https://booking.devonwatkins.com" } });
      const r = await resolveApp({ coolifyAppUuid: "hkw488ggssgcskk0ooc0ksk0", fqdn: null });
      expect(r?.branch).toBe("master");
      const createCfg = (axios.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCfg.headers["x-brain-key"]).toBe("secret-key-value");
      const getCall = mockGet().mock.calls[0];
      expect(getCall[0]).toBe("/api/apps/resolve");
      expect(getCall[1].params).toEqual({ coolify_app_uuid: "hkw488ggssgcskk0ooc0ksk0" }); // fqdn omitted when null
    });
    it("includes fqdn param when provided", async () => {
      setEnv();
      const { resolveApp } = await import("../src/services/appbrain-client.js");
      mockGet().mockResolvedValue({ status: 200, data: { github_repo: "o/r", name: "preview", branch: "preview", url: null } });
      await resolveApp({ coolifyAppUuid: "u1", fqdn: "preview.booking.devonwatkins.com" });
      expect(mockGet().mock.calls[0][1].params).toEqual({ coolify_app_uuid: "u1", fqdn: "preview.booking.devonwatkins.com" });
    });
    it("404 → null", async () => {
      setEnv();
      const { resolveApp } = await import("../src/services/appbrain-client.js");
      mockGet().mockResolvedValue({ status: 404, data: { error: "not_found" } });
      expect(await resolveApp({ coolifyAppUuid: "nope", fqdn: null })).toBeNull();
    });
    it("malformed 200 body → throws", async () => {
      setEnv();
      const { resolveApp } = await import("../src/services/appbrain-client.js");
      mockGet().mockResolvedValue({ status: 200, data: { name: "prod", branch: 5 } });
      await expect(resolveApp({ coolifyAppUuid: "u1", fqdn: null })).rejects.toThrow();
    });
    it("network error → throws", async () => {
      setEnv();
      const { resolveApp } = await import("../src/services/appbrain-client.js");
      mockGet().mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(resolveApp({ coolifyAppUuid: "u1", fqdn: null })).rejects.toThrow();
    });
    it("rejects an http:// base URL (cleartext key)", async () => {
      process.env.APPBRAIN_BASE_URL = "http://app-brain.devonwatkins.com";
      process.env.APPBRAIN_ACCESS_KEY = "k";
      const { resolveApp } = await import("../src/services/appbrain-client.js");
      await expect(resolveApp({ coolifyAppUuid: "u1", fqdn: null })).rejects.toThrow(/https/i);
    });
    it("rejects a credentialed base URL", async () => {
      process.env.APPBRAIN_BASE_URL = "https://user:pass@app-brain.devonwatkins.com";
      process.env.APPBRAIN_ACCESS_KEY = "k";
      const { resolveApp } = await import("../src/services/appbrain-client.js");
      await expect(resolveApp({ coolifyAppUuid: "u1", fqdn: null })).rejects.toThrow(/credential/i);
    });
  });
});
