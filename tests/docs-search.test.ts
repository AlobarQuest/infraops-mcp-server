import { describe, it, expect, vi } from "vitest";

// Mock axios before importing the module under test.
// vi.mock is hoisted, so the mock fn must be created via vi.hoisted (not a plain top-level const).
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("axios", () => ({ default: { get: getMock } }));

import { searchDocs } from "../src/services/docs-search.js";

// Mirrors the real llms-full.txt structure: `# Title (/path)` page headers with
// `Section [#anchor]` sub-headers, no YAML frontmatter.
const SAMPLE = [
  "# Health Checks (/docs/knowledge-base/health-checks)",
  "",
  "Configuring the healthcheck path [#configuring]",
  "",
  "Set the healthcheck path to /api/health for single-container apps so Coolify can probe readiness.",
  "",
  "# Backups (/docs/databases/backups)",
  "",
  "Scheduled backups [#scheduled]",
  "",
  "Scheduled database backups are configured using cron expressions.",
  "",
  "# Create Backup (/docs/api-reference/api/databases/create-backup)",
  "",
  '{ "post": { "summary": "Create a new scheduled backup", "build_pack": "dockercompose" } }',
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
    expect(results[0].url).toBe("https://coolify.io/docs/knowledge-base/health-checks#configuring");
    expect(results[0].title).toBe("Health Checks > Configuring the healthcheck path");
    expect(typeof results[0].snippet).toBe("string");
    expect(typeof results[0].score).toBe("number");
  });

  it("excludes /api-reference/api/ OpenAPI dump pages from results", async () => {
    const results = await searchDocs("backup", 10);
    expect(results.every((r) => !r.url.includes("/api-reference/api/"))).toBe(true);
  });

  it("caches the index (second search does not re-fetch)", async () => {
    const callsBefore = getMock.mock.calls.length;
    await searchDocs("readiness", 5);
    expect(getMock.mock.calls.length).toBe(callsBefore);
  });
});
