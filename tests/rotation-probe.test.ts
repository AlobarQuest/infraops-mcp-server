// The default probe() must use Basic auth (email:token) + the workspace-scoped
// endpoint for bitbucket, and Bearer for the rest. Secret values never reach argv/logs;
// here we assert the HTTP request the probe builds by stubbing global fetch.

import { describe, it, expect, vi, afterEach } from "vitest";
import { defaultRotationDeps } from "../src/security-drift/rotation-executor.js";

function deps() {
  return defaultRotationDeps({
    coolifyGet: async () => null,
    coolifyPatch: async () => undefined,
    coolifyPost: async () => undefined,
    loadState: () => ({ resolvedExposures: {}, lastRotated: {} }),
    saveState: () => {},
    now: "2026-07-02T00:00:00Z",
    bwsToken: "irrelevant",
  });
}

const okResp = { status: 200, arrayBuffer: async () => new ArrayBuffer(0) };

afterEach(() => vi.restoreAllMocks());

describe("default probe()", () => {
  it("bitbucket uses Basic auth (email:token) against the workspace repositories endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResp);
    vi.stubGlobal("fetch", fetchMock);
    const status = await deps().probe("bitbucket", "the-token", { email: "a@b.com", workspace: "alobarquest" });
    expect(status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.bitbucket.org/2.0/repositories/alobarquest?pagelen=1");
    const expected = "Basic " + Buffer.from("a@b.com:the-token").toString("base64");
    expect(init.headers.Authorization).toBe(expected);
  });

  it("bitbucket without email/workspace returns 400 (misconfig) — never a false 'dead' 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResp);
    vi.stubGlobal("fetch", fetchMock);
    const status = await deps().probe("bitbucket", "t", { email: "a@b.com" }); // no workspace
    expect(status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("github uses Bearer auth against the user endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResp);
    vi.stubGlobal("fetch", fetchMock);
    await deps().probe("github", "ghtok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/user");
    expect(init.headers.Authorization).toBe("Bearer ghtok");
  });
});
