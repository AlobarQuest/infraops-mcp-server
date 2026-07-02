import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSecurityWindow } from "../src/security-drift/security-executor.js";
import type { RotationDeps } from "../src/security-drift/rotation-executor.js";
import { saveEmitState } from "../src/security-drift/emit-state.js";
import { planHash } from "../src/security-drift/canonical.js";
import type { ApprovedItem } from "../src/change-manager/api-client.js";

let dir: string;
let emitStateFile: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-rot-"));
  emitStateFile = path.join(dir, "emit.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const rotationRemediation = {
  rotation: {
    credId: "github-classic-aihelper",
    credClass: "github-pat-classic",
    consumersVerified: "2026-07-02",
    retireBwsUuids: ["old-uuid"],
    consumers: [],
    providerProbe: "github",
    exposureIds: ["codex-2026-07-02"],
    manualSteps: [],
  },
};

function item(over: Partial<ApprovedItem> = {}): ApprovedItem {
  return {
    id: 7,
    identity: "mac::sec.cred.exposure-rotate::fpX",
    instance: "mac",
    rule_key: "sec.cred.exposure-rotate",
    resource_type: "cred",
    resource_uuid: "fpX",
    resource_name: "Rotate github-classic-aihelper",
    risk: "caution",
    kind: "remediation",
    reasoning: "[URGENT] cred.exposure-rotate",
    note: null,
    status: "approved",
    source: "security",
    plan: { tier: "URGENT", source: "security", remediation: rotationRemediation },
    ...over,
  };
}

function rotationDeps(oldStatus: number): { deps: RotationDeps; removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    deps: {
      bws: {
        getValue: async () => "old-value-cccccccc",
        findByName: async () => null,
        create: async () => "x",
        editValue: async () => {},
        remove: async (uuid) => {
          removed.push(uuid);
        },
      },
      keychain: { read: async () => null, write: async () => {}, remove: async () => {} },
      coolify: { getEnv: async () => null, setEnv: async () => {}, redeploy: async () => {} },
      ghSecretSet: async () => {},
      probe: async () => oldStatus,
      ghKeeperOk: async () => true,
      state: { resolveExposures: async () => {}, recordRotated: async () => {} },
    },
  };
}

function windowDeps(items: ApprovedItem[], rotation?: RotationDeps) {
  const outcomes: { id: number; outcome: string; detail?: string }[] = [];
  const integrity: string[] = [];
  return {
    outcomes,
    integrity,
    d: {
      getApprovedSecurity: async () => items,
      claim: async () => {},
      postOutcome: async (id: number, body: any) => {
        outcomes.push({ id, outcome: body.outcome, detail: body.detail });
      },
      onIntegrityFailure: async (_it: ApprovedItem, reason: string) => {
        integrity.push(reason);
      },
      emitStateFile,
      maxChanges: 10,
      rotation,
    },
  };
}

describe("runSecurityWindow — rotation remediation dispatch", () => {
  it("runs an approved rotation plan through the rotation executor when the hash matches", async () => {
    const it7 = item();
    saveEmitState(emitStateFile, { fpX: { hash: planHash(it7.plan), ts: "2026-07-02T03:00:00Z" } });
    const { deps: rot, removed } = rotationDeps(401); // old credential dead → retire path completes
    const { d, outcomes } = windowDeps([it7], rot);
    const s = await runSecurityWindow(d);
    expect(s.applied).toBe(1);
    expect(outcomes[0].outcome).toBe("done");
    expect(removed).toEqual(["old-uuid"]);
  });

  it("REFUSES a rotation plan whose hash does not match — rotation deps never invoked", async () => {
    const it7 = item();
    saveEmitState(emitStateFile, { fpX: { hash: "tampered", ts: "2026-07-02T03:00:00Z" } });
    const { deps: rot } = rotationDeps(401);
    const probeSpy = vi.spyOn(rot, "probe");
    const { d, integrity } = windowDeps([it7], rot);
    const s = await runSecurityWindow(d);
    expect(s.blocked).toBe(1);
    expect(probeSpy).not.toHaveBeenCalled();
    expect(integrity).toHaveLength(1);
  });

  it("blocks rotation items when the runner has no rotation deps wired", async () => {
    const it7 = item();
    saveEmitState(emitStateFile, { fpX: { hash: planHash(it7.plan), ts: "2026-07-02T03:00:00Z" } });
    const { d, outcomes } = windowDeps([it7], undefined);
    const s = await runSecurityWindow(d);
    expect(s.blocked).toBe(1);
    expect(outcomes[0].detail).toMatch(/rotation deps unavailable/);
  });

  it("reports blocked (not applied) while the old credential is still live", async () => {
    const it7 = item();
    saveEmitState(emitStateFile, { fpX: { hash: planHash(it7.plan), ts: "2026-07-02T03:00:00Z" } });
    const { deps: rot, removed } = rotationDeps(200); // still live
    const { d, outcomes } = windowDeps([it7], rot);
    const s = await runSecurityWindow(d);
    expect(s.blocked).toBe(1);
    expect(outcomes[0].outcome).toBe("blocked");
    expect(removed).toEqual([]);
  });
});
