import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSecurityWindow, type ExecResult } from "../src/security-drift/security-executor.js";
import { saveEmitState } from "../src/security-drift/emit-state.js";
import { planHash } from "../src/security-drift/canonical.js";
import { runWindow } from "../src/change-manager/run-window.js";
import type { ApprovedItem } from "../src/change-manager/api-client.js";

let dir: string;
let emitStateFile: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-exec-")); emitStateFile = path.join(dir, "emit.json"); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function item(over: Partial<ApprovedItem> = {}): ApprovedItem {
  return {
    id: 1, identity: "mac::sec.os.screen_lock::fp1", instance: "mac", rule_key: "sec.os.screen_lock",
    resource_type: "os", resource_uuid: "fp1", resource_name: "Screen lock",
    risk: "safe", kind: "remediation", reasoning: "[NORMAL] os.screen_lock", note: null, status: "approved",
    source: "security",
    plan: { tier: "NORMAL", source: "security", remediation: { exec: [["echo", "hi"]] } },
    ...over,
  };
}

function deps(items: ApprovedItem[], exec?: (cmd: string[]) => ExecResult) {
  const claimed: number[] = [];
  const outcomes: { id: number; outcome: string; detail?: string }[] = [];
  const integrity: { id: number; reason: string }[] = [];
  return {
    claimed, outcomes, integrity,
    d: {
      getApprovedSecurity: async () => items,
      claim: async (id: number) => { claimed.push(id); },
      postOutcome: async (id: number, body: any) => { outcomes.push({ id, outcome: body.outcome, detail: body.detail }); },
      onIntegrityFailure: async (it: ApprovedItem, reason: string) => { integrity.push({ id: it.id, reason }); },
      emitStateFile,
      maxChanges: 10,
      exec,
    },
  };
}

describe("runSecurityWindow", () => {
  it("runs an approved exec item VERBATIM when the plan hash matches", async () => {
    const it = item();
    saveEmitState(emitStateFile, { fp1: { hash: planHash(it.plan), ts: "2026-06-15T03:00:00Z" } });
    const spy = vi.fn((_cmd: string[]): ExecResult => ({ ok: true, detail: "ok" }));
    const { d, outcomes, claimed } = deps([it], spy);
    const s = await runSecurityWindow(d);
    expect(claimed).toEqual([1]);
    expect(spy).toHaveBeenCalledWith(["echo", "hi"]); // exact argv, no shell
    expect(s.applied).toBe(1);
    expect(outcomes[0].outcome).toBe("done");
  });

  it("REFUSES to run when the plan hash does not match (tamper) and never execs", async () => {
    const it = item();
    saveEmitState(emitStateFile, { fp1: { hash: "deadbeef-not-the-real-hash", ts: "2026-06-15T03:00:00Z" } });
    const spy = vi.fn((_cmd: string[]): ExecResult => ({ ok: true, detail: "ok" }));
    const { d, outcomes, integrity } = deps([it], spy);
    const s = await runSecurityWindow(d);
    expect(spy).not.toHaveBeenCalled(); // command NOT run
    expect(s.blocked).toBe(1);
    expect(outcomes[0].outcome).toBe("blocked");
    expect(integrity).toHaveLength(1);
  });

  it("REFUSES when there is no recorded hash for the item", async () => {
    const it = item();
    saveEmitState(emitStateFile, {}); // empty
    const spy = vi.fn((_cmd: string[]): ExecResult => ({ ok: true, detail: "ok" }));
    const { d, integrity } = deps([it], spy);
    const s = await runSecurityWindow(d);
    expect(spy).not.toHaveBeenCalled();
    expect(s.blocked).toBe(1);
    expect(integrity).toHaveLength(1);
  });

  it("tracks (does not execute) a manual remediation even with a valid hash", async () => {
    const it = item({ plan: { tier: "URGENT", source: "security", remediation: { manual: ["rotate the token"] } } });
    saveEmitState(emitStateFile, { fp1: { hash: planHash(it.plan), ts: "2026-06-15T03:00:00Z" } });
    const spy = vi.fn((_cmd: string[]): ExecResult => ({ ok: true, detail: "ok" }));
    const { d, outcomes } = deps([it], spy);
    const s = await runSecurityWindow(d);
    expect(spy).not.toHaveBeenCalled();
    expect(s.blocked).toBe(1);
    expect(outcomes[0].detail).toMatch(/manual/);
  });

  it("blocks the whole batch if the emit-state file is tampered (loose mode)", async () => {
    fs.writeFileSync(emitStateFile, "{}");
    fs.chmodSync(emitStateFile, 0o644); // not 0600 → integrity error on load
    const it = item();
    const spy = vi.fn((_cmd: string[]): ExecResult => ({ ok: true, detail: "ok" }));
    const { d, integrity } = deps([it], spy);
    const s = await runSecurityWindow(d);
    expect(spy).not.toHaveBeenCalled();
    expect(s.blocked).toBe(1);
    expect(integrity).toHaveLength(1);
  });
});

describe("run-window excludes security items", () => {
  it("never hands a source=security item to the Coolify agent", async () => {
    const security = item();
    const coolify = { ...item({ id: 2, resource_name: "app1" }), source: "drift" } as ApprovedItem;
    const ran: number[] = [];
    const s = await runWindow({
      getApproved: async () => [security, coolify],
      claim: async () => {},
      runAgent: async (it) => { ran.push(it.id); return { outcome: "done", detail: "", rollback: {}, tool_calls: { calls: [] } }; },
      postOutcome: async () => {},
      maxChangesPerWindow: 5,
    });
    expect(ran).toEqual([2]); // only the drift item
    expect(s.considered).toBe(1);
  });
});
