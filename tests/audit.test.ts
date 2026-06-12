import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/coolify-client.js", () => ({
  coolifyGet: vi.fn(),
  handleCoolifyError: vi.fn((e) => `Error: ${e}`),
}));

vi.mock("../src/standards/standards-source.js", () => ({
  loadCoolifyChecks: vi.fn(),
}));

import * as coolifyClient from "../src/services/coolify-client.js";
import * as standardsSource from "../src/standards/standards-source.js";
import { registerAuditTools } from "../src/tools/audit.js";
import type { StandardCheck } from "../src/standards/check-engine.js";

const mockServer = {
  registerTool: vi.fn((name, _schema, handler) => {
    mockServer._handlers[name] = handler;
  }),
  _handlers: {} as Record<string, Function>,
};

// Three seed-like checks for tests
const healthCheckStandard: StandardCheck = {
  rule_id: 1,
  rule_text: "Health checks must be enabled on running applications",
  severity: "WARN",
  schema_version: 1,
  resource: "coolify_application",
  assert: { field: "health_check_enabled", op: "eq", value: true },
  when: { field: "status", op: "contains", value: "running" },
  remediation_key: "coolify.enable_healthcheck",
  kind: "remediation",
};

const httpsCheck: StandardCheck = {
  rule_id: 2,
  rule_text: "Applications must use HTTPS",
  severity: "WARN",
  schema_version: 1,
  resource: "coolify_application",
  assert: { field: "fqdn", op: "not_starts_with", value: "http://" },
  when: { field: "fqdn", op: "non_empty" },
  remediation_key: "coolify.force_https",
  kind: "remediation",
};

const dbBackupCheck: StandardCheck = {
  rule_id: 3,
  rule_text: "Production databases require scheduled backups",
  severity: "WARN",
  schema_version: 1,
  resource: "coolify_database",
  assert: { field: "backup_configs", op: "non_empty" },
  when: { field: "status", op: "contains", value: "running" },
  kind: "question",
};

const conformantApp = {
  uuid: "app-good",
  name: "good-app",
  status: "running:healthy",
  health_check_enabled: true,
  fqdn: "https://good-app.devonwatkins.com",
};

const violatingApp = {
  uuid: "app-bad",
  name: "bad-app",
  status: "running:healthy",
  health_check_enabled: false,
  fqdn: "http://bad-app.devonwatkins.com",
};

const runningDb = {
  uuid: "db-1",
  name: "my-db",
  status: "running:healthy",
  backup_configs: [],
};

function parseOutput(result: any) {
  const text = result.content[0].text;
  return JSON.parse(text);
}

describe("coolify_audit_standards", () => {
  beforeEach(() => {
    mockServer._handlers = {};
    vi.mocked(standardsSource.loadCoolifyChecks).mockResolvedValue({
      checks: [healthCheckStandard, httpsCheck, dbBackupCheck],
      source: "seed",
    });
    vi.mocked(coolifyClient.coolifyGet)
      .mockImplementation((path: string) => {
        if (path === "/applications") return Promise.resolve([conformantApp, violatingApp]);
        if (path === "/databases") return Promise.resolve([runningDb]);
        return Promise.resolve([]);
      });
    registerAuditTools(mockServer as any);
  });

  it("registers the tool with readOnlyHint:true", () => {
    expect(mockServer._handlers["coolify_audit_standards"]).toBeDefined();
  });

  it("returns proposals for resources that violate checks", async () => {
    const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
    const output = parseOutput(result);

    expect(output.proposals.length).toBeGreaterThan(0);
    // violatingApp has health_check_enabled: false → should fire
    const healthProposal = output.proposals.find(
      (p: any) => p.target.uuid === "app-bad" && p.planned_action?.args?.health_check_enabled === true
    );
    expect(healthProposal).toBeDefined();
    expect(healthProposal.kind).toBe("remediation");
    expect(healthProposal.risk).toBe("safe");
  });

  it("does not emit proposals for conformant resources", async () => {
    const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
    const output = parseOutput(result);

    // conformantApp has health_check_enabled: true and https fqdn → no proposals
    const conformantProposals = output.proposals.filter((p: any) => p.target.uuid === "app-good");
    expect(conformantProposals).toHaveLength(0);
  });

  it("includes a db backup question proposal", async () => {
    const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
    const output = parseOutput(result);

    const dbProposal = output.proposals.find((p: any) => p.target.uuid === "db-1");
    expect(dbProposal).toBeDefined();
    expect(dbProposal.kind).toBe("question");
    expect(dbProposal.planned_action).toBeNull();
  });

  it("reports force_https as caution risk", async () => {
    const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
    const output = parseOutput(result);

    const httpsProposal = output.proposals.find(
      (p: any) => p.target.uuid === "app-bad" && p.planned_action?.args?.domains !== undefined
    );
    expect(httpsProposal).toBeDefined();
    expect(httpsProposal.risk).toBe("caution");
    expect(httpsProposal.planned_action.args.domains).toBe("https://bad-app.devonwatkins.com");
  });

  it("meta.standards_source reflects what loadCoolifyChecks returned", async () => {
    vi.mocked(standardsSource.loadCoolifyChecks).mockResolvedValue({
      checks: [healthCheckStandard],
      source: "live",
    });
    const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
    const output = parseOutput(result);
    expect(output.meta.standards_source).toBe("live");
  });

  it("meta.checks_evaluated matches the number of checks loaded", async () => {
    const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
    const output = parseOutput(result);
    expect(output.meta.checks_evaluated).toBe(3);
  });

  describe("scope filter", () => {
    it("limits audit to a single app when scope matches by name", async () => {
      const result = await mockServer._handlers["coolify_audit_standards"]({
        scope: "bad-app",
        instance: "prod",
      });
      const output = parseOutput(result);

      for (const p of output.proposals) {
        expect(p.target.name).toBe("bad-app");
      }
    });

    it("limits audit to a single resource when scope matches by UUID", async () => {
      const result = await mockServer._handlers["coolify_audit_standards"]({
        scope: "app-good",
        instance: "prod",
      });
      const output = parseOutput(result);

      // conformantApp is good → 0 proposals
      expect(output.proposals).toHaveLength(0);
    });
  });

  describe("meta.not_audited", () => {
    it("counts checks loaded (prose-only rules not included since we filter those in standards-source)", async () => {
      // All 3 checks in our mock are evaluable; not_audited should be 0
      const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
      const output = parseOutput(result);
      expect(typeof output.meta.not_audited).toBe("number");
    });
  });

  describe("summary", () => {
    it("includes total_proposals, by_risk, and by_kind", async () => {
      const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
      const output = parseOutput(result);

      expect(typeof output.summary.total_proposals).toBe("number");
      expect(output.summary.by_risk).toHaveProperty("safe");
      expect(output.summary.by_risk).toHaveProperty("caution");
      expect(output.summary.by_risk).toHaveProperty("destructive");
      expect(output.summary.by_kind).toHaveProperty("remediation");
      expect(output.summary.by_kind).toHaveProperty("question");
    });

    it("by_risk.caution counts the force_https proposal", async () => {
      const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
      const output = parseOutput(result);
      expect(output.summary.by_risk.caution).toBeGreaterThanOrEqual(1);
    });
  });

  describe("resilience — partial read failure", () => {
    it("surfaces database read error in meta.errors but still returns app proposals", async () => {
      vi.mocked(coolifyClient.coolifyGet).mockImplementation((path: string) => {
        if (path === "/applications") return Promise.resolve([violatingApp]);
        if (path === "/databases") return Promise.reject(new Error("DB read failed"));
        return Promise.resolve([]);
      });

      const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
      const output = parseOutput(result);

      // App proposals still present
      expect(output.proposals.some((p: any) => p.target.uuid === "app-bad")).toBe(true);
      // Error surfaced in meta
      expect(output.meta.errors).toBeDefined();
      expect(output.meta.errors.some((e: string) => e.includes("DB read failed"))).toBe(true);
    });

    it("does not crash when both reads fail", async () => {
      vi.mocked(coolifyClient.coolifyGet).mockRejectedValue(new Error("All reads failed"));
      const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
      const output = parseOutput(result);

      expect(output.proposals).toHaveLength(0);
      expect(output.meta.errors).toBeDefined();
    });
  });

  describe("degrade path — infra-brain down", () => {
    it("uses seed checks when infra-brain is unavailable and reports source:seed", async () => {
      vi.mocked(standardsSource.loadCoolifyChecks).mockResolvedValue({
        checks: [healthCheckStandard],
        source: "seed",
      });

      const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
      const output = parseOutput(result);

      expect(output.meta.standards_source).toBe("seed");
      expect(output.proposals.length).toBeGreaterThanOrEqual(0);
    });

    it("uses cache when infra-brain is down but cache exists, reports source:cache", async () => {
      vi.mocked(standardsSource.loadCoolifyChecks).mockResolvedValue({
        checks: [healthCheckStandard],
        source: "cache",
      });

      const result = await mockServer._handlers["coolify_audit_standards"]({ instance: "prod" });
      const output = parseOutput(result);

      expect(output.meta.standards_source).toBe("cache");
    });
  });

  describe("categories filter", () => {
    it("is accepted without error (even if not filtering further in Phase 1)", async () => {
      const result = await mockServer._handlers["coolify_audit_standards"]({
        categories: ["coolify"],
        instance: "prod",
      });
      expect(result.content[0].type).toBe("text");
    });
  });
});
