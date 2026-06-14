import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChangeMgrClient } from "../src/change-manager/api-client.js";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("ChangeMgrClient", () => {
  it("postSync sends the M2M bearer + body and returns the summary", async () => {
    fetchMock.mockResolvedValue(ok({ new: 1, refreshed: 0, resolved: 0, reopened: 0 }));
    const c = new ChangeMgrClient("https://cm.example", "tok");
    const r = await c.postSync({ generated_at: "t", source_report: "r.json", escalations: [] });
    expect(r.new).toBe(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cm.example/api/sync");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("getApproved lists approved items", async () => {
    fetchMock.mockResolvedValue(ok([{ id: 1, status: "approved" }]));
    const c = new ChangeMgrClient("https://cm.example", "tok");
    const items = await c.getApproved();
    expect(items).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/items?status=approved");
  });

  it("claim throws on 409 (already claimed)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, text: async () => "conflict" });
    const c = new ChangeMgrClient("https://cm.example", "tok");
    await expect(c.claim(1)).rejects.toThrow(/409/);
  });
});
