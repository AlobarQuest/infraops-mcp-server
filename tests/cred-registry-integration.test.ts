// Guards the real registry + the finding→plan join against silent drift:
// 1. the repo's own .cred-consumers.toml must parse under the strict-subset parser
//    (a syntax the parser rejects would otherwise surface only as a nightly
//    cred.registry-error, silencing every real rotation finding);
// 2. every finding credFindings() emits must route through classify() to its
//    registry-built classification — never the "unplanned" deny-by-default fallback
//    (the `${check}|${target}` join key is built in two places and must agree).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCredConsumers } from "../src/security-drift/cred-consumers.js";
import { buildCredClassifications, credFindings } from "../src/security-drift/cred-rotation.js";
import { classify } from "../src/security-drift/taxonomy.js";

const REPO_TOML = path.join(__dirname, "..", ".cred-consumers.toml");

describe("the repo's own .cred-consumers.toml", () => {
  const specs = parseCredConsumers(fs.readFileSync(REPO_TOML, "utf8"));

  it("parses and carries the 5 leaked-cred entries with attested consumer sets", () => {
    expect(specs.map((s) => s.id).sort()).toEqual([
      "bitbucket-mirror-token",
      "github-classic-aihelper",
      "github-classic-lifeops",
      "github-finegrained-mirror",
      "openai-project",
      "openrouter-generic",
    ]);
    for (const s of specs) expect(s.consumers_verified, `${s.id} must be sweep-attested`).toBeTruthy();
  });

  it("routes every emitted finding to its registry-built classification, never the unplanned fallback", () => {
    const state = { resolvedExposures: {}, lastRotated: {} };
    const findings = credFindings(specs, state, "2026-07-02T03:00:00Z");
    expect(findings.length).toBe(6); // one open exposure per credential
    const credClassifications = buildCredClassifications(specs, state);
    for (const f of findings) {
      const c = classify(f, { autoFixAllowlist: [], credClassifications });
      expect(c, `${f.target} must classify`).not.toBeNull();
      expect(c!.title).not.toMatch(/unplanned/);
    }
  });

  it("yields executor-runnable plans for exactly the eligible creds (openrouter + the 2 BWS-held classic PATs)", () => {
    const state = { resolvedExposures: {}, lastRotated: {} };
    const cls = buildCredClassifications(specs, state);
    const kindOf = (id: string) => {
      const c = cls[`cred.exposure-rotate|cred:${id}`];
      return "rotation" in c.remediation ? "rotation" : "manual";
    };
    expect(kindOf("openrouter-generic")).toBe("rotation");
    expect(kindOf("github-classic-aihelper")).toBe("rotation");
    expect(kindOf("github-classic-lifeops")).toBe("rotation");
    expect(kindOf("github-finegrained-mirror")).toBe("rotation"); // mirror.py leak fixed+deployed → precondition cleared
    expect(kindOf("bitbucket-mirror-token")).toBe("rotation"); // atlassian-api-token class + bitbucket probe
    expect(kindOf("openai-project")).toBe("manual"); // no BWS copy to probe
  });
});
