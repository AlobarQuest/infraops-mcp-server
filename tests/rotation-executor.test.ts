import { describe, it, expect, vi } from "vitest";
import { runRotationPlan, type RotationDeps } from "../src/security-drift/rotation-executor.js";
import type { RotationPlanSpec } from "../src/security-drift/cred-rotation.js";

// Fake secret values — deliberately NOT token-shaped (write-guard) but long enough
// for the scrubber to register.
const OLD_VAL = "old-value-aaaaaaaa";
const NEW_VAL = "new-value-bbbbbbbb";

function reissuePlan(over: Partial<RotationPlanSpec> = {}): RotationPlanSpec {
  return {
    credId: "openrouter-generic",
    credClass: "openrouter-key",
    fingerprint8: "57543baa",
    consumersVerified: "2026-07-02",
    staging: { service: "cred-rotation", account: "openrouter-generic" },
    keeperBwsUuid: "keeper-uuid",
    quarantineName: "openrouter-generic-pre-rotation-quarantine",
    bwsProjectId: "proj-uuid",
    retireBwsUuids: [],
    consumers: [
      { kind: "bws-secret", uuid: "keeper-uuid" },
      { kind: "keychain", service: "openrouter-api", account: "devon" },
    ],
    providerProbe: "openrouter",
    exposureIds: ["codex-2026-07-02"],
    manualSteps: ["revoke at console"],
    ...over,
  };
}

function retirePlan(over: Partial<RotationPlanSpec> = {}): RotationPlanSpec {
  return {
    credId: "github-classic-aihelper",
    credClass: "github-pat-classic",
    fingerprint8: "26058655",
    consumersVerified: "2026-07-02",
    retireBwsUuids: ["old-pat-uuid"],
    consumers: [{ kind: "bws-secret", uuid: "old-pat-uuid" }],
    providerProbe: "github",
    exposureIds: ["codex-2026-07-02"],
    manualSteps: ["enumerate SSH keys", "revoke at console"],
    ...over,
  };
}

interface FakeState {
  bws: Map<string, { name?: string; value: string }>;
  keychain: Map<string, string>;
  probes: Record<string, number>; // value → status
  keeperOk: boolean;
  resolved: string[];
  rotated: string[];
  removedBws: string[];
  removedKeychain: string[];
}

function fakeDeps(s: FakeState): RotationDeps {
  const kc = (svc: string, acct: string) => `${svc}/${acct}`;
  return {
    bws: {
      getValue: async (uuid) => s.bws.get(uuid)?.value ?? null,
      findByName: async (name) => {
        for (const [id, v] of s.bws) if (v.name === name) return { id, value: v.value };
        return null;
      },
      create: async (name, value) => {
        const id = `created-${name}`;
        s.bws.set(id, { name, value });
        return id;
      },
      editValue: async (uuid, value) => {
        const cur = s.bws.get(uuid);
        if (!cur) throw new Error(`no secret ${uuid}`);
        s.bws.set(uuid, { ...cur, value });
      },
      remove: async (uuid) => {
        s.bws.delete(uuid);
        s.removedBws.push(uuid);
      },
    },
    keychain: {
      read: async (svc, acct) => s.keychain.get(kc(svc, acct)) ?? null,
      write: async (svc, acct, value) => {
        s.keychain.set(kc(svc, acct), value);
      },
      remove: async (svc, acct) => {
        s.keychain.delete(kc(svc, acct));
        s.removedKeychain.push(kc(svc, acct));
      },
    },
    coolify: {
      getEnv: async () => null,
      setEnv: vi.fn(async () => {}),
      redeploy: vi.fn(async () => {}),
    },
    ghSecretSet: vi.fn(async () => {}),
    probe: async (_kind, value) => s.probes[value] ?? 500,
    ghKeeperOk: async () => s.keeperOk,
    state: {
      resolveExposures: async (credId, ids) => {
        s.resolved.push(...ids.map((i) => `${credId}:${i}`));
      },
      recordRotated: async (credId) => {
        s.rotated.push(credId);
      },
    },
  };
}

function baseState(over: Partial<FakeState> = {}): FakeState {
  return {
    bws: new Map([["keeper-uuid", { name: "OPENROUTER_API_KEY", value: OLD_VAL }]]),
    keychain: new Map(),
    probes: {},
    keeperOk: true,
    resolved: [],
    rotated: [],
    removedBws: [],
    removedKeychain: [],
    ...over,
  };
}

describe("runRotationPlan — reissue path (store → deploy → verify → revoke-confirm)", () => {
  it("blocks when the new value is not staged and nothing was quarantined", async () => {
    const s = baseState();
    const r = await runRotationPlan(reissuePlan(), fakeDeps(s));
    expect(r.outcome).toBe("blocked");
    expect(r.detail).toMatch(/not staged/);
    expect(s.bws.get("keeper-uuid")!.value).toBe(OLD_VAL); // untouched
    expect(s.resolved).toEqual([]);
  });

  it("night 1: quarantines old, updates keeper + consumers, verifies, then BLOCKS while the old credential is still live — nothing retired", async () => {
    const s = baseState();
    s.keychain.set("cred-rotation/openrouter-generic", NEW_VAL);
    s.probes[NEW_VAL] = 200;
    s.probes[OLD_VAL] = 200; // Devon has not revoked yet
    const r = await runRotationPlan(reissuePlan(), fakeDeps(s));
    expect(r.outcome).toBe("blocked");
    expect(r.detail).toMatch(/still LIVE/);
    // store happened: quarantine holds the OLD value, keeper holds the NEW value
    expect(s.bws.get("created-openrouter-generic-pre-rotation-quarantine")!.value).toBe(OLD_VAL);
    expect(s.bws.get("keeper-uuid")!.value).toBe(NEW_VAL);
    // deploy happened
    expect(s.keychain.get("openrouter-api/devon")).toBe(NEW_VAL);
    // but NOTHING was retired or resolved (revoke-first is impossible)
    expect(s.removedBws).toEqual([]);
    expect(s.resolved).toEqual([]);
  });

  it("night 2: old credential dead (401) → retires quarantine, clears staging, resolves the exposure", async () => {
    const s = baseState();
    s.bws.set("q-uuid", { name: "openrouter-generic-pre-rotation-quarantine", value: OLD_VAL });
    s.bws.set("keeper-uuid", { name: "OPENROUTER_API_KEY", value: NEW_VAL });
    s.keychain.set("openrouter-api/devon", NEW_VAL);
    s.probes[NEW_VAL] = 200;
    s.probes[OLD_VAL] = 401;
    const r = await runRotationPlan(reissuePlan(), fakeDeps(s));
    expect(r.outcome).toBe("done");
    expect(s.removedBws).toEqual(["q-uuid"]);
    expect(s.resolved).toEqual(["openrouter-generic:codex-2026-07-02"]);
    expect(s.rotated).toEqual(["openrouter-generic"]);
  });

  it("verify failure (new value does not authenticate) → failed, old value never probed/retired", async () => {
    const s = baseState();
    s.keychain.set("cred-rotation/openrouter-generic", NEW_VAL);
    s.probes[NEW_VAL] = 401; // bad staged value
    s.probes[OLD_VAL] = 401; // even though old is dead, we must not touch it
    const r = await runRotationPlan(reissuePlan(), fakeDeps(s));
    expect(r.outcome).toBe("failed");
    expect(r.detail).toMatch(/verify FAILED/);
    expect(s.removedBws).toEqual([]);
    expect(s.resolved).toEqual([]);
  });

  it("indeterminate old-credential probe (403/5xx) never retires", async () => {
    const s = baseState();
    s.bws.set("q-uuid", { name: "openrouter-generic-pre-rotation-quarantine", value: OLD_VAL });
    s.bws.set("keeper-uuid", { name: "OPENROUTER_API_KEY", value: NEW_VAL });
    s.probes[NEW_VAL] = 200;
    s.probes[OLD_VAL] = 503;
    const r = await runRotationPlan(reissuePlan(), fakeDeps(s));
    expect(r.outcome).toBe("blocked");
    expect(r.detail).toMatch(/indeterminate/);
    expect(s.removedBws).toEqual([]);
  });

  it("keeper already updated but old value never quarantined → blocked (cannot confirm revoke), no guessing", async () => {
    const s = baseState();
    s.bws.set("keeper-uuid", { name: "OPENROUTER_API_KEY", value: NEW_VAL });
    s.keychain.set("cred-rotation/openrouter-generic", NEW_VAL);
    const r = await runRotationPlan(reissuePlan(), fakeDeps(s));
    expect(r.outcome).toBe("blocked");
    expect(r.detail).toMatch(/no quarantined old value/);
  });

  it("is idempotent when re-run with staging still present after completion state (keeper == staged, quarantine exists)", async () => {
    const s = baseState();
    s.bws.set("q-uuid", { name: "openrouter-generic-pre-rotation-quarantine", value: OLD_VAL });
    s.bws.set("keeper-uuid", { name: "OPENROUTER_API_KEY", value: NEW_VAL });
    s.keychain.set("cred-rotation/openrouter-generic", NEW_VAL);
    s.keychain.set("openrouter-api/devon", NEW_VAL);
    s.probes[NEW_VAL] = 200;
    s.probes[OLD_VAL] = 401;
    const r = await runRotationPlan(reissuePlan(), fakeDeps(s));
    expect(r.outcome).toBe("done");
    expect(s.bws.get("keeper-uuid")!.value).toBe(NEW_VAL);
    expect(s.removedKeychain).toContain("cred-rotation/openrouter-generic");
  });
});

describe("runRotationPlan — revoke-no-replacement path", () => {
  it("blocks while the old credential is still live", async () => {
    const s = baseState({ bws: new Map([["old-pat-uuid", { value: OLD_VAL }]]) });
    s.probes[OLD_VAL] = 200;
    const r = await runRotationPlan(retirePlan(), fakeDeps(s));
    expect(r.outcome).toBe("blocked");
    expect(r.detail).toMatch(/still LIVE/);
    expect(s.removedBws).toEqual([]);
  });

  it("retires the BWS copy and resolves the exposure once dead (401)", async () => {
    const s = baseState({ bws: new Map([["old-pat-uuid", { value: OLD_VAL }]]) });
    s.probes[OLD_VAL] = 401;
    const r = await runRotationPlan(retirePlan(), fakeDeps(s));
    expect(r.outcome).toBe("done");
    expect(s.removedBws).toEqual(["old-pat-uuid"]);
    expect(s.resolved).toEqual(["github-classic-aihelper:codex-2026-07-02"]);
  });

  it("github keeper-verification: a broken gh keeper fails BEFORE any bookkeeping", async () => {
    const s = baseState({ bws: new Map([["old-pat-uuid", { value: OLD_VAL }]]), keeperOk: false });
    s.probes[OLD_VAL] = 401;
    const r = await runRotationPlan(retirePlan(), fakeDeps(s));
    expect(r.outcome).toBe("failed");
    expect(r.detail).toMatch(/keeper/i);
    expect(s.removedBws).toEqual([]);
    expect(s.resolved).toEqual([]);
  });
});

describe("runRotationPlan — structural guards", () => {
  it("refuses classes that are never executor-runnable (pg password)", async () => {
    const s = baseState();
    const r = await runRotationPlan(retirePlan({ credClass: "coolify-pg-password" }), fakeDeps(s));
    expect(r.outcome).toBe("blocked");
    expect(r.detail).toMatch(/not executor-runnable/);
  });

  it("refuses unknown classes (deny-by-default)", async () => {
    const s = baseState();
    const r = await runRotationPlan(retirePlan({ credClass: "mystery-token" }), fakeDeps(s));
    expect(r.outcome).toBe("blocked");
  });

  it("refuses an unattested consumer set (fail-safe)", async () => {
    const s = baseState();
    const r = await runRotationPlan(retirePlan({ consumersVerified: "" }), fakeDeps(s));
    expect(r.outcome).toBe("blocked");
    expect(r.detail).toMatch(/not attested/);
  });

  it("fails loudly on a consumer kind the executor does not support", async () => {
    const s = baseState();
    s.keychain.set("cred-rotation/openrouter-generic", NEW_VAL);
    s.probes[NEW_VAL] = 200;
    const r = await runRotationPlan(
      reissuePlan({ consumers: [{ kind: "shell-export", file: "~/.zshrc", var: "X" }] }),
      fakeDeps(s),
    );
    expect(r.outcome).toBe("failed");
    expect(r.detail).toMatch(/unsupported consumer kind/);
  });

  it("scrubs secret values out of error details", async () => {
    const s = baseState();
    s.keychain.set("cred-rotation/openrouter-generic", NEW_VAL);
    const deps = fakeDeps(s);
    deps.bws.editValue = async () => {
      throw new Error(`boom: refused to write ${NEW_VAL} somewhere`);
    };
    const r = await runRotationPlan(reissuePlan(), deps);
    expect(r.outcome).toBe("failed");
    expect(r.detail).not.toContain(NEW_VAL);
    expect(r.detail).toContain("[redacted]");
  });
});
