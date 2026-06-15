import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSelfCheck, type SelfCheckConfig } from "../src/security-drift/self-check.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-selfcheck-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function cfg(over: Partial<SelfCheckConfig> = {}): SelfCheckConfig {
  return {
    stateFiles: [],
    auditLog: path.join(dir, "audit.jsonl"),
    hwmFile: path.join(dir, "hwm.json"),
    integrityFiles: [],
    hashFile: path.join(dir, "hashes.json"),
    now: "2026-06-15T03:00:00Z",
    ...over,
  };
}

describe("runSelfCheck", () => {
  it("flags a state file that is not 0600", () => {
    const f = path.join(dir, "baseline.json");
    fs.writeFileSync(f, "{}");
    fs.chmodSync(f, 0o644);
    const findings = runSelfCheck(cfg({ stateFiles: [f] }));
    expect(findings.map((x) => x.check)).toContain("selfcheck.state_perms");
  });

  it("passes a 0600 state file", () => {
    const f = path.join(dir, "baseline.json");
    fs.writeFileSync(f, "{}", { mode: 0o600 });
    fs.chmodSync(f, 0o600);
    expect(runSelfCheck(cfg({ stateFiles: [f] }))).toHaveLength(0);
  });

  it("flags an audit log that shrank vs the recorded high-water mark", () => {
    const audit = path.join(dir, "audit.jsonl");
    fs.writeFileSync(audit, "x".repeat(100));
    runSelfCheck(cfg({ auditLog: audit })); // records hwm=100
    fs.writeFileSync(audit, "x".repeat(40)); // shrank → tamper
    const findings = runSelfCheck(cfg({ auditLog: audit }));
    expect(findings.map((x) => x.check)).toContain("auditlog.tampered");
  });

  it("does not flag an audit log that only grows", () => {
    const audit = path.join(dir, "audit.jsonl");
    fs.writeFileSync(audit, "x".repeat(100));
    runSelfCheck(cfg({ auditLog: audit }));
    fs.writeFileSync(audit, "x".repeat(200));
    expect(runSelfCheck(cfg({ auditLog: audit }))).toHaveLength(0);
  });

  it("seeds on first sight then flags a changed scanner/config file", () => {
    const scan = path.join(dir, "security-scan.sh");
    fs.writeFileSync(scan, "#original");
    expect(runSelfCheck(cfg({ integrityFiles: [scan] }))).toHaveLength(0); // seed
    fs.writeFileSync(scan, "#TAMPERED");
    const findings = runSelfCheck(cfg({ integrityFiles: [scan] }));
    expect(findings.map((x) => x.check)).toContain("selfcheck.runner_integrity");
  });
});
