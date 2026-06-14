import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli/change-mgr-cli.js";

describe("change-mgr-cli parseArgs", () => {
  it("parses the subcommand and flags", () => {
    const a = parseArgs(["run-window", "--report-dir", "/r", "--now", "2026-06-15T04:00:00Z"]);
    expect(a.command).toBe("run-window");
    expect(a["report-dir"]).toBe("/r");
    expect(a.now).toBe("2026-06-15T04:00:00Z");
  });
  it("captures sync as the command", () => {
    expect(parseArgs(["sync", "--report-dir", "/r"]).command).toBe("sync");
  });
});
