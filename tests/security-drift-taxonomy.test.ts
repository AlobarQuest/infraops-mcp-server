import { describe, it, expect } from "vitest";
import { classify } from "../src/security-drift/taxonomy.js";
import type { Finding } from "../src/security-drift/scan-parser.js";

const f = (over: Partial<Finding>): Finding => ({
  severity: "FAIL",
  check: "credfile.over_permissive",
  detail: "/Users/x/.env (mode 644) group/other-readable",
  target: "/Users/x/.env",
  ...over,
});

describe("classify", () => {
  it("auto-fixes an allowlisted over-permissive cred file", () => {
    const c = classify(f({}), { autoFixAllowlist: ["/Users/x/.env"] });
    expect(c).toMatchObject({ tier: "AUTO_FIX", kind: "remediation", risk: "safe" });
    expect(c && "exec" in c.remediation).toBe(true);
  });

  it("URGENTs a non-allowlisted over-permissive cred file (deny-by-default)", () => {
    const c = classify(f({}), { autoFixAllowlist: [] });
    expect(c?.tier).toBe("URGENT");
    expect(c && "manual" in c.remediation).toBe(true);
  });

  it("URGENTs a re-inlined shell secret (never auto)", () => {
    const c = classify(f({ check: "shell.plaintext_secret", target: "/Users/x/.zshrc", detail: "/Users/x/.zshrc: TOKEN=<inline value>" }), { autoFixAllowlist: [] });
    expect(c?.tier).toBe("URGENT");
    expect(c && "manual" in c.remediation).toBe(true);
  });

  it("classifies an OS hardening toggle as NORMAL with an exact exec", () => {
    const c = classify(f({ check: "os.screen_lock", target: "screen lock off (askForPassword=0)", detail: "screen lock off (askForPassword=0)" }), { autoFixAllowlist: [] });
    expect(c?.tier).toBe("NORMAL");
    expect(c && "exec" in c.remediation && c.remediation.exec[0][0]).toBe("defaults");
  });

  it("URGENTs an unknown check key (deny-by-default)", () => {
    const c = classify(f({ check: "brand.new_thing", target: "x", detail: "x" }), { autoFixAllowlist: [] });
    expect(c?.tier).toBe("URGENT");
  });

  it("drops a false-positive .env.example", () => {
    const c = classify(f({ target: "/Users/x/.env.example", detail: "/Users/x/.env.example (mode 644)" }), { autoFixAllowlist: ["/Users/x/.env.example"] });
    expect(c).toBeNull();
  });

  it("drops a public fullchain.pem false positive", () => {
    const c = classify(f({ check: "credfile.private_key", target: "/Users/x/certs/fullchain.pem", detail: "/Users/x/certs/fullchain.pem (mode 644)" }), { autoFixAllowlist: [] });
    expect(c).toBeNull();
  });
});
