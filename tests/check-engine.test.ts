import { describe, it, expect } from "vitest";
import { evaluateCheck } from "../src/standards/check-engine.js";
import type { StandardCheck } from "../src/standards/check-engine.js";

const baseCheck: Omit<StandardCheck, "assert" | "resource"> = {
  rule_id: 1,
  rule_text: "Health checks must be enabled",
  severity: "WARN",
  schema_version: 1,
  kind: "remediation",
  remediation_key: "coolify.enable_healthcheck",
};

const noRemediation = () => null;

// A simple running app
const runningApp: Record<string, unknown> = {
  uuid: "app-uuid-1",
  name: "my-app",
  status: "running:healthy",
  health_check_enabled: false,
  fqdn: "https://my-app.devonwatkins.com",
  backup_configs: [],
};

describe("evaluateCheck — op: eq", () => {
  it("fires a proposal when field value violates eq", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "health_check_enabled", op: "eq", value: true },
    };
    const proposal = evaluateCheck(check, { ...runningApp, health_check_enabled: false }, noRemediation);
    expect(proposal).not.toBeNull();
    // noRemediation returns null → key unresolvable → falls back to "question"
    expect(proposal!.kind).toBe("question");
    expect(proposal!.target.uuid).toBe("app-uuid-1");
  });

  it("returns null when field value satisfies eq", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "health_check_enabled", op: "eq", value: true },
    };
    const proposal = evaluateCheck(check, { ...runningApp, health_check_enabled: true }, noRemediation);
    expect(proposal).toBeNull();
  });
});

describe("evaluateCheck — op: neq", () => {
  it("fires when field equals the forbidden value", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "status", op: "neq", value: "stopped" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, status: "stopped" }, noRemediation);
    expect(proposal).not.toBeNull();
  });

  it("returns null when field does not equal the forbidden value", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "status", op: "neq", value: "stopped" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, status: "running" }, noRemediation);
    expect(proposal).toBeNull();
  });
});

describe("evaluateCheck — op: contains / not_contains", () => {
  it("fires for contains when substring is missing", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "status", op: "contains", value: "running" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, status: "stopped" }, noRemediation);
    expect(proposal).not.toBeNull();
  });

  it("returns null for contains when substring present", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "status", op: "contains", value: "running" },
    };
    expect(evaluateCheck(check, runningApp, noRemediation)).toBeNull();
  });

  it("fires for not_contains when substring is present", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "fqdn", op: "not_contains", value: "http://" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, fqdn: "http://insecure.com" }, noRemediation);
    expect(proposal).not.toBeNull();
  });
});

describe("evaluateCheck — op: present / absent", () => {
  it("fires for present when field is null", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "fqdn", op: "present" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, fqdn: null }, noRemediation);
    expect(proposal).not.toBeNull();
  });

  it("fires for present when field key is missing", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "fqdn", op: "present" },
    };
    const { fqdn: _f, ...noFqdn } = runningApp;
    const proposal = evaluateCheck(check, noFqdn, noRemediation);
    expect(proposal).not.toBeNull();
  });

  it("returns null for present when field is set", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "fqdn", op: "present" },
    };
    expect(evaluateCheck(check, runningApp, noRemediation)).toBeNull();
  });

  it("fires for absent when field is present and non-null", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "fqdn", op: "absent" },
    };
    const proposal = evaluateCheck(check, runningApp, noRemediation);
    expect(proposal).not.toBeNull();
  });
});

describe("evaluateCheck — op: empty / non_empty", () => {
  it("fires for non_empty when array is empty", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_database",
      assert: { field: "backup_configs", op: "non_empty" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, backup_configs: [] }, noRemediation);
    expect(proposal).not.toBeNull();
  });

  it("returns null for non_empty when array has items", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_database",
      assert: { field: "backup_configs", op: "non_empty" },
    };
    expect(evaluateCheck(check, { ...runningApp, backup_configs: [{ id: 1 }] }, noRemediation)).toBeNull();
  });

  it("fires for empty when string is non-empty", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "custom_labels", op: "empty" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, custom_labels: "some-label" }, noRemediation);
    expect(proposal).not.toBeNull();
  });

  it("returns null for non_empty when string has content", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "name", op: "non_empty" },
    };
    expect(evaluateCheck(check, runningApp, noRemediation)).toBeNull();
  });
});

describe("evaluateCheck — op: starts_with / not_starts_with", () => {
  it("fires for not_starts_with when string starts with the prefix", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "fqdn", op: "not_starts_with", value: "http://" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, fqdn: "http://insecure.com" }, noRemediation);
    expect(proposal).not.toBeNull();
  });

  it("returns null for not_starts_with when prefix absent", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "fqdn", op: "not_starts_with", value: "http://" },
    };
    expect(evaluateCheck(check, runningApp, noRemediation)).toBeNull();
  });

  it("fires for starts_with when string lacks the prefix", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "fqdn", op: "starts_with", value: "https://" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, fqdn: "http://insecure.com" }, noRemediation);
    expect(proposal).not.toBeNull();
  });
});

describe("evaluateCheck — op: matches", () => {
  it("fires when field does not match the pattern", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "name", op: "matches", value: "^[a-z]" },
    };
    const proposal = evaluateCheck(check, { ...runningApp, name: "123-bad" }, noRemediation);
    expect(proposal).not.toBeNull();
  });

  it("returns null when field matches the pattern", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "name", op: "matches", value: "^[a-z]" },
    };
    expect(evaluateCheck(check, runningApp, noRemediation)).toBeNull();
  });
});

describe("evaluateCheck — when precondition", () => {
  it("skips the check when 'when' precondition is not satisfied", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "health_check_enabled", op: "eq", value: true },
      when: { field: "status", op: "contains", value: "running" },
    };
    // Status is "stopped" so precondition fails → check should be skipped (null)
    const proposal = evaluateCheck(check, { ...runningApp, status: "stopped", health_check_enabled: false }, noRemediation);
    expect(proposal).toBeNull();
  });

  it("evaluates the check when 'when' precondition is satisfied", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "health_check_enabled", op: "eq", value: true },
      when: { field: "status", op: "contains", value: "running" },
    };
    const proposal = evaluateCheck(check, runningApp, noRemediation);
    expect(proposal).not.toBeNull();
  });
});

describe("evaluateCheck — unknown op", () => {
  it("returns null (skip, no throw) for an unrecognized op", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "name", op: "future_op" as any },
    };
    expect(() => evaluateCheck(check, runningApp, noRemediation)).not.toThrow();
    expect(evaluateCheck(check, runningApp, noRemediation)).toBeNull();
  });
});

describe("evaluateCheck — remediation resolution", () => {
  it("includes planned_action when remediation resolves", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "health_check_enabled", op: "eq", value: true },
      remediation_key: "coolify.enable_healthcheck",
    };
    const resolve = (_key: string, res: Record<string, unknown>) => ({
      action: { tool: "coolify_update_application", args: { uuid: res.uuid, health_check_enabled: true } },
      risk: "safe" as const,
    });
    const proposal = evaluateCheck(check, { ...runningApp, health_check_enabled: false }, resolve);
    expect(proposal!.kind).toBe("remediation");
    expect(proposal!.planned_action).toEqual({
      tool: "coolify_update_application",
      args: { uuid: "app-uuid-1", health_check_enabled: true },
    });
    expect(proposal!.risk).toBe("safe");
  });

  it("falls back to kind:question and null planned_action when remediation key is unknown", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "health_check_enabled", op: "eq", value: true },
      remediation_key: "unknown.key",
    };
    const proposal = evaluateCheck(check, { ...runningApp, health_check_enabled: false }, noRemediation);
    expect(proposal!.kind).toBe("question");
    expect(proposal!.planned_action).toBeNull();
    expect(proposal!.risk).toBe("safe");
  });

  it("produces a question check when no remediation_key", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      kind: "question",
      remediation_key: undefined,
      assert: { field: "health_check_enabled", op: "eq", value: true },
    };
    const proposal = evaluateCheck(check, { ...runningApp, health_check_enabled: false }, noRemediation);
    expect(proposal!.kind).toBe("question");
    expect(proposal!.planned_action).toBeNull();
  });

  it("includes rule provenance in reasoning", () => {
    const check: StandardCheck = {
      ...baseCheck,
      rule_id: 42,
      rule_text: "health checks must be on",
      severity: "WARN",
      resource: "coolify_application",
      assert: { field: "health_check_enabled", op: "eq", value: true },
    };
    const proposal = evaluateCheck(check, { ...runningApp, health_check_enabled: false }, noRemediation);
    expect(proposal!.reasoning).toContain("42");
    expect(proposal!.reasoning).toContain("WARN");
  });

  it("proposal id includes the remediation_key when present", () => {
    const check: StandardCheck = {
      ...baseCheck,
      resource: "coolify_application",
      assert: { field: "health_check_enabled", op: "eq", value: true },
      remediation_key: "coolify.enable_healthcheck",
    };
    const proposal = evaluateCheck(check, { ...runningApp, health_check_enabled: false }, noRemediation);
    expect(proposal!.id).toMatch(/^coolify\.enable_healthcheck:/);
  });
});
