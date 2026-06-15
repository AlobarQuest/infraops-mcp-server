import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadBaseline, saveBaseline, diffFindings, snapshot, fingerprint, BaselineIntegrityError } from "../src/security-drift/baseline.js";
import type { Finding } from "../src/security-drift/scan-parser.js";
import type { Classification } from "../src/security-drift/taxonomy.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-baseline-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const finding = (check: string, target: string): Finding => ({ severity: "FAIL", check, detail: target, target });
const cls = (tier: Classification["tier"]): Classification => ({ tier, kind: "question", risk: "caution", remediation: { manual: ["x"] }, title: "t" });

describe("baseline integrity", () => {
  it("returns null when the baseline file is missing (first run)", () => {
    expect(loadBaseline(path.join(dir, "nope.json"))).toBeNull();
  });

  it("round-trips a 0600 baseline", () => {
    const file = path.join(dir, "b.json");
    saveBaseline(file, { abc: { firstSeen: "t", tier: "URGENT" } });
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe("600");
    expect(loadBaseline(file)).toEqual({ abc: { firstSeen: "t", tier: "URGENT" } });
  });

  it("throws BaselineIntegrityError when the file is group/other readable", () => {
    const file = path.join(dir, "loose.json");
    fs.writeFileSync(file, "{}");
    fs.chmodSync(file, 0o644);
    expect(() => loadBaseline(file)).toThrow(BaselineIntegrityError);
  });
});

describe("diffFindings", () => {
  it("flags new findings and tier changes, suppresses unchanged", () => {
    const a = { finding: finding("credfile.over_permissive", "/a"), classification: cls("AUTO_FIX") };
    const b = { finding: finding("shell.plaintext_secret", "/b"), classification: cls("URGENT") };
    const base = snapshot([a, b], "t0");
    // unchanged → suppressed
    expect(diffFindings([a, b], base)).toHaveLength(0);
    // new finding → surfaced
    const c = { finding: finding("os.screen_lock", "scr"), classification: cls("NORMAL") };
    expect(diffFindings([a, b, c], base).map((d) => d.finding.check)).toEqual(["os.screen_lock"]);
    // tier change on an existing fingerprint → re-surfaced
    const aEscalated = { finding: a.finding, classification: cls("URGENT") };
    expect(diffFindings([aEscalated], base)).toHaveLength(1);
  });

  it("fingerprint is stable for the same check+target", () => {
    expect(fingerprint("c", "/t")).toBe(fingerprint("c", "/t"));
    expect(fingerprint("c", "/t")).not.toBe(fingerprint("c", "/u"));
  });
});
