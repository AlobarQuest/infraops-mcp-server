// defaultRotationDeps must run its bws child processes with the DEDICATED
// cred-rotation token in their env — never the broad ambient BWS_ACCESS_TOKEN.
// We can't exec real `bws` in a unit test, so we assert the env the wrapper builds
// by stubbing child_process.execFileSync and capturing the options it receives.

import { describe, it, expect, vi, afterEach } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync }));

import { defaultRotationDeps } from "../src/security-drift/rotation-executor.js";

afterEach(() => execFileSync.mockReset());

function deps(bwsToken: string) {
  return defaultRotationDeps({
    coolifyGet: async () => null,
    coolifyPatch: async () => undefined,
    coolifyPost: async () => undefined,
    loadState: () => ({ resolvedExposures: {}, lastRotated: {} }),
    saveState: () => {},
    now: "2026-07-02T00:00:00Z",
    bwsToken,
  });
}

describe("defaultRotationDeps token isolation", () => {
  it("runs bws with the dedicated rotation token, overriding the ambient BWS_ACCESS_TOKEN", async () => {
    process.env.BWS_ACCESS_TOKEN = "AMBIENT-BROAD-TOKEN";
    execFileSync.mockReturnValue(JSON.stringify({ value: "v" }));
    await deps("ROTATION-SCOPED-TOKEN").bws.getValue("uuid-1");
    expect(execFileSync).toHaveBeenCalledTimes(1);
    const opts = execFileSync.mock.calls[0][2];
    expect(opts.env.BWS_ACCESS_TOKEN).toBe("ROTATION-SCOPED-TOKEN");
    expect(opts.env.BWS_ACCESS_TOKEN).not.toBe("AMBIENT-BROAD-TOKEN");
  });

  it("passes the rotation token to write ops (delete) too, shell:false", async () => {
    execFileSync.mockReturnValue("");
    await deps("ROTATION-SCOPED-TOKEN").bws.remove("uuid-2");
    const [bin, argv, opts] = execFileSync.mock.calls[0];
    expect(bin).toBe("bws");
    expect(argv).toEqual(["secret", "delete", "uuid-2"]);
    expect(opts.shell).toBe(false);
    expect(opts.env.BWS_ACCESS_TOKEN).toBe("ROTATION-SCOPED-TOKEN");
  });

  it("does NOT put the rotation token in the env of non-bws (keychain) child processes", async () => {
    execFileSync.mockReturnValue("kc-value\n");
    await deps("ROTATION-SCOPED-TOKEN").keychain.read("svc", "acct");
    const opts = execFileSync.mock.calls[0][2];
    // keychain reads inherit the default env (no explicit override) — the rotation
    // token is confined to the bws calls that need write.
    expect(opts.env).toBeUndefined();
  });
});
