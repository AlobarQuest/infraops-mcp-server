import { describe, it, expect } from "vitest";
import { jsonResponse, truncateLogs } from "../src/utils/response.js";
import { summarize, toApplicationSummary } from "../src/utils/summaries.js";
import { maskSensitive, maskSensitiveList } from "../src/utils/masking.js";

describe("jsonResponse", () => {
  it("returns pretty JSON under the limit untouched", () => {
    const r = jsonResponse({ a: 1 });
    expect(r.content[0].text).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(r.isError).toBeUndefined();
  });

  it("truncates with a marker when over charLimit", () => {
    const big = { blob: "x".repeat(5000) };
    const r = jsonResponse(big, { charLimit: 500 });
    expect(r.content[0].text.length).toBeLessThanOrEqual(500);
    expect(r.content[0].text).toContain("[truncated");
  });
});

describe("truncateLogs", () => {
  const logs = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");

  it("page 1 returns the newest lineLimit lines", () => {
    const r = truncateLogs(logs, 200, 1_000_000, 1);
    expect(r.total_lines).toBe(1000);
    expect(r.showing_end).toBe(1000);
    expect(r.showing_start).toBe(800);
    expect(r.logs.endsWith("line 999")).toBe(true);
  });

  it("page 2 walks older", () => {
    const r = truncateLogs(logs, 200, 1_000_000, 2);
    expect(r.showing_end).toBe(800);
    expect(r.showing_start).toBe(600);
  });
});

describe("summarize", () => {
  it("projects when summary=true and passes through when false", () => {
    const apps = [{ uuid: "u1", name: "a", status: "running", extra: "drop-me" }];
    const projected = summarize(apps, toApplicationSummary, true) as any[];
    expect(projected[0]).not.toHaveProperty("extra");
    expect(projected[0]).toMatchObject({ uuid: "u1", name: "a", status: "running" });
    expect(summarize(apps, toApplicationSummary, false)).toBe(apps);
  });
});

describe("maskSensitive", () => {
  it("masks webhook/basic-auth secrets, preserves null, honors reveal", () => {
    const app = {
      name: "x",
      manual_webhook_secret_github: "shhh",
      manual_webhook_secret_gitlab: null,
      http_basic_auth_password: "pw",
    };
    const masked = maskSensitive(app);
    expect(masked.manual_webhook_secret_github).toBe("***");
    expect(masked.http_basic_auth_password).toBe("***");
    expect(masked.manual_webhook_secret_gitlab).toBeNull(); // null = "no secret set"
    expect(masked.name).toBe("x");
    // reveal returns the original untouched
    expect(maskSensitive(app, true).manual_webhook_secret_github).toBe("shhh");
  });

  it("maskSensitiveList masks each item unless reveal", () => {
    const list = [{ http_basic_auth_password: "pw" }];
    expect(maskSensitiveList(list)[0].http_basic_auth_password).toBe("***");
    expect(maskSensitiveList(list, true)[0].http_basic_auth_password).toBe("pw");
  });
});
