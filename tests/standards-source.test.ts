import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/infrabrain-client.js", () => ({
  infrabrainGet: vi.fn(),
  isInfrabrainConfigured: vi.fn(),
}));

vi.mock("fs", () => {
  const fns = {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "[]"),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
  return { default: fns, ...fns };
});

// Import after mocks are set up
import * as infrabrainClient from "../src/services/infrabrain-client.js";
import * as fs from "fs";
import { loadCoolifyChecks } from "../src/standards/standards-source.js";

describe("seed-checks", () => {
  it("exports at least the 3 Phase 1 seed checks", async () => {
    const { SEED_CHECKS } = await import("../src/standards/seed-checks.js");
    expect(Array.isArray(SEED_CHECKS)).toBe(true);
    expect(SEED_CHECKS.length).toBeGreaterThanOrEqual(3);

    const keys = SEED_CHECKS.map((c) => c.remediation_key);
    expect(keys).toContain("coolify.enable_healthcheck");
    expect(keys).toContain("coolify.force_https");
  });

  it("seed checks have the correct shape", async () => {
    const { SEED_CHECKS } = await import("../src/standards/seed-checks.js");
    for (const check of SEED_CHECKS) {
      expect(typeof check.rule_id).toBe("number");
      expect(typeof check.rule_text).toBe("string");
      expect(["BLOCK", "WARN", "INFO"]).toContain(check.severity);
      expect(typeof check.schema_version).toBe("number");
      expect(["coolify_application", "coolify_database"]).toContain(check.resource);
      expect(check.assert).toBeDefined();
      expect(typeof check.assert.field).toBe("string");
    }
  });

  it("db-backup seed check is kind:question with no remediation_key", async () => {
    const { SEED_CHECKS } = await import("../src/standards/seed-checks.js");
    const dbBackup = SEED_CHECKS.find((c) => c.resource === "coolify_database");
    expect(dbBackup).toBeDefined();
    expect(dbBackup!.kind).toBe("question");
    expect(dbBackup!.remediation_key).toBeUndefined();
  });
});

describe("loadCoolifyChecks — fallback behavior", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("[]");
    vi.mocked(infrabrainClient.isInfrabrainConfigured).mockReturnValue(false);
    vi.mocked(infrabrainClient.infrabrainGet).mockRejectedValue(new Error("not configured"));
  });

  it("returns source:'live' and writes cache when infra-brain responds successfully", async () => {
    vi.mocked(infrabrainClient.isInfrabrainConfigured).mockReturnValue(true);
    vi.mocked(infrabrainClient.infrabrainGet).mockResolvedValue({
      rules: [
        {
          id: 1,
          rule: "Health checks must be enabled",
          severity: "WARN",
          category: "coolify",
          check: {
            rule_id: 1,
            rule_text: "Health checks must be enabled",
            severity: "WARN",
            schema_version: 1,
            resource: "coolify_application",
            assert: { field: "health_check_enabled", op: "eq", value: true },
            when: { field: "status", op: "contains", value: "running" },
            remediation_key: "coolify.enable_healthcheck",
            kind: "remediation",
          },
        },
      ],
    });

    const result = await loadCoolifyChecks();

    expect(result.source).toBe("live");
    expect(result.checks.length).toBeGreaterThanOrEqual(1);
    expect(result.checks[0].remediation_key).toBe("coolify.enable_healthcheck");
  });

  it("returns source:'seed' when infra-brain is not configured and no cache", async () => {
    vi.mocked(infrabrainClient.isInfrabrainConfigured).mockReturnValue(false);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await loadCoolifyChecks();

    expect(result.source).toBe("seed");
    expect(result.checks.length).toBeGreaterThanOrEqual(3);
  });

  it("returns source:'seed' when infra-brain is configured but unreachable and no cache", async () => {
    vi.mocked(infrabrainClient.isInfrabrainConfigured).mockReturnValue(true);
    vi.mocked(infrabrainClient.infrabrainGet).mockRejectedValue(new Error("ECONNREFUSED"));
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await loadCoolifyChecks();

    expect(result.source).toBe("seed");
    expect(result.checks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns source:'cache' when infra-brain is unreachable but cache exists", async () => {
    vi.mocked(infrabrainClient.isInfrabrainConfigured).mockReturnValue(true);
    vi.mocked(infrabrainClient.infrabrainGet).mockRejectedValue(new Error("Network error"));
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const cachedChecks = [
      {
        rule_id: 99,
        rule_text: "Cached check",
        severity: "WARN",
        schema_version: 1,
        resource: "coolify_application",
        assert: { field: "health_check_enabled", op: "eq", value: true },
        kind: "remediation",
        remediation_key: "coolify.enable_healthcheck",
      },
    ];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedChecks));

    const result = await loadCoolifyChecks();

    expect(result.source).toBe("cache");
    expect(result.checks[0].rule_id).toBe(99);
  });

  it("falls back to seed when cache file is corrupt", async () => {
    vi.mocked(infrabrainClient.isInfrabrainConfigured).mockReturnValue(false);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("{ invalid json }}}");

    const result = await loadCoolifyChecks();

    expect(result.source).toBe("seed");
  });

  it("filters out rules with no check field from live response", async () => {
    vi.mocked(infrabrainClient.isInfrabrainConfigured).mockReturnValue(true);
    vi.mocked(infrabrainClient.infrabrainGet).mockResolvedValue({
      rules: [
        {
          id: 1,
          rule: "Prose-only rule",
          severity: "INFO",
          category: "coolify",
          check: null,
        },
        {
          id: 2,
          rule: "Structured rule",
          severity: "WARN",
          category: "coolify",
          check: {
            rule_id: 2,
            rule_text: "Structured rule",
            severity: "WARN",
            schema_version: 1,
            resource: "coolify_application",
            assert: { field: "health_check_enabled", op: "eq", value: true },
            kind: "remediation",
            remediation_key: "coolify.enable_healthcheck",
          },
        },
      ],
    });

    const result = await loadCoolifyChecks();

    expect(result.source).toBe("live");
    expect(result.checks.length).toBe(1);
    expect(result.checks[0].rule_id).toBe(2);
  });
});
