import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  credFindings,
  buildCredClassifications,
  loadRotationState,
  saveRotationState,
  RotationStateIntegrityError,
  CLASS_POLICY,
  credTarget,
  STAGING_SERVICE,
  type RotationState,
} from "../src/security-drift/cred-rotation.js";
import { classify } from "../src/security-drift/taxonomy.js";
import type { CredentialSpec } from "../src/security-drift/cred-consumers.js";

const NOW = "2026-07-02T00:00:00.000Z";

function daysAgo(days: number): string {
  return new Date(new Date(NOW).getTime() - days * 86_400_000).toISOString();
}

function emptyState(): RotationState {
  return { resolvedExposures: {}, lastRotated: {} };
}

function baseSpec(overrides: Partial<CredentialSpec> = {}): CredentialSpec {
  return {
    id: "cred-x",
    class: "openrouter-key",
    bws_uuid: "bws-uuid-x",
    consumers_verified: "2026-06-01",
    disposition: "reissue",
    rotation_preconditions: [],
    consumers: [
      { kind: "bws-secret", uuid: "consumer-uuid-1" },
      { kind: "keychain", service: "cred-rotation", account: "cred-x" },
    ],
    exposures: [{ id: "exp-1", date: "2026-01-01", source: "test" }],
    ...overrides,
  };
}

describe("rotation state store", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns the empty state when the file is missing", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-rotation-"));
    expect(loadRotationState(path.join(dir, "nope.json"))).toEqual({ resolvedExposures: {}, lastRotated: {} });
  });

  it("round-trips a saved state and the file is mode 0600", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-rotation-"));
    const file = path.join(dir, "state.json");
    const state: RotationState = {
      resolvedExposures: { "cred-x:exp-1": { ts: "2026-06-01T00:00:00.000Z", detail: "resolved" } },
      lastRotated: { "cred-x": "2026-06-01T00:00:00.000Z" },
    };
    saveRotationState(file, state);
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe("600");
    expect(loadRotationState(file)).toEqual(state);
  });

  it("throws RotationStateIntegrityError when the file is group/other readable", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cred-rotation-"));
    const file = path.join(dir, "loose.json");
    fs.writeFileSync(file, "{}");
    fs.chmodSync(file, 0o644);
    expect(() => loadRotationState(file)).toThrow(RotationStateIntegrityError);
  });
});

describe("credFindings", () => {
  it("emits one cred.exposure-rotate FAIL for an unresolved exposure", () => {
    const spec = baseSpec({ exposures: [{ id: "exp-9", date: "2026-01-01", source: "leak" }] });
    const findings = credFindings([spec], emptyState(), NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("FAIL");
    expect(findings[0].check).toBe("cred.exposure-rotate");
    expect(findings[0].target).toBe(credTarget(spec.id));
    expect(findings[0].detail).toContain("exp-9");
  });

  it("suppresses the exposure finding once it is recorded resolved in state", () => {
    const spec = baseSpec({ exposures: [{ id: "exp-9", date: "2026-01-01", source: "leak" }] });
    const state: RotationState = {
      resolvedExposures: { [`${spec.id}:exp-9`]: { ts: NOW, detail: "rotated" } },
      lastRotated: {},
    };
    expect(credFindings([spec], state, NOW)).toHaveLength(0);
  });

  it("emits a cred.rotation-age WARN for an old credential with no open exposure", () => {
    const spec = baseSpec({
      class: "github-pat-classic",
      created: daysAgo(300),
      last_rotated: undefined,
      exposures: [],
    });
    const findings = credFindings([spec], emptyState(), NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("WARN");
    expect(findings[0].check).toBe("cred.rotation-age");
    expect(findings[0].target).toBe(credTarget(spec.id));
  });

  it("exposure supersedes age — only the exposure finding is emitted", () => {
    const spec = baseSpec({
      class: "github-pat-classic",
      created: daysAgo(300),
      last_rotated: undefined,
      exposures: [{ id: "exp-9", date: "2026-01-01", source: "leak" }],
    });
    const findings = credFindings([spec], emptyState(), NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("cred.exposure-rotate");
  });

  it("a recent state.lastRotated suppresses the age finding", () => {
    const spec = baseSpec({
      class: "github-pat-classic",
      created: daysAgo(300),
      last_rotated: undefined,
      exposures: [],
    });
    const state: RotationState = { resolvedExposures: {}, lastRotated: { [spec.id]: daysAgo(1) } };
    expect(credFindings([spec], state, NOW)).toHaveLength(0);
  });
});

describe("buildCredClassifications", () => {
  it("builds an executor-runnable reissue plan for an eligible spec", () => {
    const spec = baseSpec();
    const out = buildCredClassifications([spec], emptyState());
    const target = credTarget(spec.id);

    const rotate = out[`cred.exposure-rotate|${target}`];
    expect(rotate.tier).toBe("URGENT");
    expect(rotate.kind).toBe("remediation");
    expect("rotation" in rotate.remediation).toBe(true);
    const plan = (rotate.remediation as { rotation: any }).rotation;
    expect(plan.staging).toEqual({ service: STAGING_SERVICE, account: spec.id });
    expect(plan.keeperBwsUuid).toBe(spec.bws_uuid);
    expect(plan.quarantineName).toBe(`${spec.id}-pre-rotation-quarantine`);
    expect(plan.retireBwsUuids).toEqual([]);
    expect(plan.exposureIds).toContain("exp-1");
    expect(plan.manualSteps.join("\n")).toContain("CREATE (Devon)");

    const age = out[`cred.rotation-age|${target}`];
    expect(age.tier).toBe("NORMAL");
  });

  it("builds a retire-only plan for revoke-no-replacement, with the SSH-key landmine", () => {
    const spec = baseSpec({
      class: "github-pat-classic",
      disposition: "revoke-no-replacement",
    });
    const target = credTarget(spec.id);
    const out = buildCredClassifications([spec], emptyState());
    const rotate = out[`cred.exposure-rotate|${target}`];
    expect(rotate.kind).toBe("remediation");
    const plan = (rotate.remediation as { rotation: any }).rotation;
    expect(plan.retireBwsUuids).toEqual([spec.bws_uuid]);
    expect(plan.staging).toBeUndefined();
    expect(plan.keeperBwsUuid).toBeUndefined();
    expect(plan.manualSteps.join("\n")).toContain("LANDMINE");
  });

  it("falls back to manual when consumers_verified is missing (fail-safe)", () => {
    const spec = baseSpec({ consumers_verified: undefined });
    const target = credTarget(spec.id);
    const out = buildCredClassifications([spec], emptyState());
    const rotate = out[`cred.exposure-rotate|${target}`];
    expect(rotate.kind).toBe("question");
    expect("rotation" in rotate.remediation).toBe(false);
    const manual = (rotate.remediation as { manual: string[] }).manual;
    expect(manual.join("\n")).toContain("consumer set not attested");
  });

  it("falls back to manual when rotation_preconditions is non-empty", () => {
    const spec = baseSpec({ rotation_preconditions: ["fix the thing first"] });
    const out = buildCredClassifications([spec], emptyState());
    const rotate = out[`cred.exposure-rotate|${credTarget(spec.id)}`];
    expect("rotation" in rotate.remediation).toBe(false);
    const manual = (rotate.remediation as { manual: string[] }).manual;
    expect(manual.join("\n")).toContain("fix the thing first");
  });

  it("falls back to manual for an unsupported consumer kind", () => {
    const spec = baseSpec({ consumers: [{ kind: "shell-export" }] });
    const out = buildCredClassifications([spec], emptyState());
    const rotate = out[`cred.exposure-rotate|${credTarget(spec.id)}`];
    expect("rotation" in rotate.remediation).toBe(false);
    const manual = (rotate.remediation as { manual: string[] }).manual;
    expect(manual.join("\n")).toContain("shell-export");
  });

  it.each(["coolify-pg-password", "bws-machine-token", "brain-mcp-key"])(
    "class %s is always manual — never an executor rotation plan",
    (cls) => {
      const spec = baseSpec({ class: cls });
      const out = buildCredClassifications([spec], emptyState());
      const rotate = out[`cred.exposure-rotate|${credTarget(spec.id)}`];
      expect("rotation" in rotate.remediation).toBe(false);
      expect(rotate.kind).toBe("question");
    },
  );

  it("mentions the NEVER-cycle landmine for coolify-pg-password", () => {
    const spec = baseSpec({ class: "coolify-pg-password" });
    const out = buildCredClassifications([spec], emptyState());
    const rotate = out[`cred.exposure-rotate|${credTarget(spec.id)}`];
    const manual = (rotate.remediation as { manual: string[] }).manual;
    expect(manual.join("\n")).toContain("NEVER cycle");
  });

  it("falls back to manual with no BWS copy of the old value (orphan credential)", () => {
    const spec = baseSpec({ class: "openai-key", bws_uuid: undefined });
    const out = buildCredClassifications([spec], emptyState());
    const rotate = out[`cred.exposure-rotate|${credTarget(spec.id)}`];
    expect("rotation" in rotate.remediation).toBe(false);
    const manual = (rotate.remediation as { manual: string[] }).manual;
    expect(manual.join("\n")).toContain("cannot confirm");
  });
});

describe("classify() cred.* routing", () => {
  it("returns exactly the registry-built classification when present", () => {
    const built = {
      tier: "URGENT" as const,
      kind: "remediation" as const,
      risk: "caution" as const,
      remediation: { manual: ["do the thing"] },
      title: "Rotate cred-x",
    };
    const c = classify(
      { severity: "FAIL", check: "cred.exposure-rotate", target: "cred:x", detail: "d" },
      { autoFixAllowlist: [], credClassifications: { "cred.exposure-rotate|cred:x": built } },
    );
    expect(c).toBe(built);
  });

  it("falls back to an URGENT manual classification titled 'unplanned' when no entry matches", () => {
    const c = classify(
      { severity: "FAIL", check: "cred.exposure-rotate", target: "cred:y", detail: "d" },
      { autoFixAllowlist: [], credClassifications: {} },
    );
    expect(c?.tier).toBe("URGENT");
    expect(c && "manual" in c.remediation).toBe(true);
    expect(c?.title).toContain("unplanned");
  });

  it("still routes a cred finding whose target resembles an FP pattern (not dropped)", () => {
    const c = classify(
      { severity: "FAIL", check: "cred.exposure-rotate", target: "cred:test", detail: "d" },
      { autoFixAllowlist: [], credClassifications: {} },
    );
    expect(c).not.toBeNull();
  });
});

describe("CLASS_POLICY sanity", () => {
  it("defines a policy for every class exercised above", () => {
    for (const cls of ["github-pat-classic", "github-pat-fine-grained", "openrouter-key", "openai-key", "brain-mcp-key", "coolify-pg-password", "bws-machine-token"]) {
      expect(CLASS_POLICY[cls]).toBeDefined();
    }
  });
});
