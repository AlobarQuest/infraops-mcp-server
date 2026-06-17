import { describe, it, expect, vi } from "vitest";

// Mock axios before importing the module under test.
const getMock = vi.fn();
vi.mock("axios", () => ({ default: { get: getMock } }));

import { searchDocs } from "../src/services/docs-search.js";

const SAMPLE = [
  "url: https://coolify.io/docs/health",
  "description: Health check configuration",
  "title: Health Checks",
  "---",
  "# Health Checks",
  "",
  "## Configuring the healthcheck path",
  "Set the healthcheck path to /api/health for single-container apps so Coolify can probe readiness.",
].join("\n");

describe("searchDocs", () => {
  it("fetches, indexes, and returns scored results with snippets", async () => {
    getMock.mockResolvedValueOnce({ data: SAMPLE });
    const results = await searchDocs("healthcheck path", 5);
    expect(getMock).toHaveBeenCalledWith(
      "https://coolify.io/docs/llms-full.txt",
      expect.objectContaining({ timeout: 15000 })
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toBe("https://coolify.io/docs/health");
    expect(results[0].title).toContain("Health Checks");
    expect(typeof results[0].snippet).toBe("string");
    expect(typeof results[0].score).toBe("number");
  });

  it("caches the index (second search does not re-fetch)", async () => {
    const callsBefore = getMock.mock.calls.length;
    await searchDocs("readiness", 5);
    expect(getMock.mock.calls.length).toBe(callsBefore);
  });
});
