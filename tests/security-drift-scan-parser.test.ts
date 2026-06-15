import { describe, it, expect } from "vitest";
import { parseScan, extractTarget } from "../src/security-drift/scan-parser.js";

describe("parseScan", () => {
  it("parses severity, check, and detail from padded scanner lines", () => {
    const out = [
      "=== security-scan 2026-06-15T00:00:00Z ===",
      "FAIL credfile.over_permissive          /Users/x/.env (mode 644) group/other-readable",
      "WARN supply.octo_drift                 octo HEAD abc123 != pin def456",
      "PASS hooks.gate                        high-power-gate.sh present and registered",
      "=== summary: PASS=1 WARN=1 FAIL=1 ===",
    ].join("\n");
    const f = parseScan(out);
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ severity: "FAIL", check: "credfile.over_permissive", target: "/Users/x/.env" });
    expect(f[1]).toMatchObject({ severity: "WARN", check: "supply.octo_drift" });
    expect(f[2]).toMatchObject({ severity: "PASS", check: "hooks.gate" });
  });

  it("keeps only the key name for secret-bearing details (no value reconstruction)", () => {
    const out = "FAIL shell.plaintext_secret            /Users/x/.zshrc: OPENAI_API_KEY=<inline value> (move to Keychain)";
    const f = parseScan(out);
    expect(f[0].check).toBe("shell.plaintext_secret");
    expect(f[0].target).toBe("/Users/x/.zshrc");
    // detail carries the scanner's redacted form verbatim; we never widen it
    expect(f[0].detail).toContain("<inline value>");
  });
});

describe("extractTarget", () => {
  it("splits on ' (mode ' even when the path has spaces", () => {
    expect(extractTarget("/Users/devon/from iMac/downloads/k.pem (mode 022) world-writable"))
      .toBe("/Users/devon/from iMac/downloads/k.pem");
  });
  it("splits a 'file: rest' detail at the colon", () => {
    expect(extractTarget("claude_desktop_config.json: SOME_TOKEN has inline value")).toBe("claude_desktop_config.json");
  });
  it("falls back to the whole detail for listeners/os checks", () => {
    expect(extractTarget("port 6379 bound to 0.0.0.0 (want 127.0.0.1)")).toBe("port 6379 bound to 0.0.0.0 (want 127.0.0.1)");
  });
});
