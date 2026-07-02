#!/usr/bin/env node
// Security-drift runner CLI. Invoked from the 3am drift-audit.sh job:
//   node dist/cli/security-drift-cli.js run --report-dir ~/infra-drift/reports --now <ISO>
//
// Runs ~/.claude/bin/security-scan.sh, classifies + diffs, auto-fixes the narrow set,
// posts the rest to the change-manager (source="security"), and emails NEW urgent
// items immediately. All write-state files are mode 0600.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ChangeMgrClient } from "../change-manager/api-client.js";
import { runSecurityDrift } from "../security-drift/runner.js";
import { sendUrgentEmail } from "../security-drift/notify.js";
import { securityPaths } from "../security-drift/paths.js";
import { runSelfCheck } from "../security-drift/self-check.js";
import { classify } from "../security-drift/taxonomy.js";
import { buildEscalations, type ClassifiedFinding } from "../security-drift/emit.js";
import { scannerVersionGate, EXPECTED_SCANNER_OUTPUT_VERSION } from "../security-drift/scanner-version.js";
import { loadCredConsumerFiles } from "../security-drift/cred-consumers.js";
import {
  buildCredClassifications,
  credFindings,
  loadRotationState,
  saveRotationState,
} from "../security-drift/cred-rotation.js";
import type { Finding } from "../security-drift/scan-parser.js";
import type { Classification } from "../security-drift/taxonomy.js";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  if (argv[0] && !argv[0].startsWith("--")) args.command = argv[0];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { args[key] = next; i++; }
    else args[key] = true;
  }
  return args;
}

/** Read a newline-delimited config list (paths/substrings); missing file → []. */
function readList(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function captureScan(scanPath: string): string {
  // security-scan.sh exits 1 when drift is found — that is expected, not an error.
  try {
    return execFileSync("/bin/bash", [scanPath], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch (e: any) {
    if (typeof e?.stdout === "string") return e.stdout; // non-zero exit: stdout still has the findings
    throw e;
  }
}

/** Record that Devon confirmed a provider-side revoke the executor cannot probe
 *  (no BWS copy of the old value) — clears the cred.exposure-rotate finding. */
function doResolveExposure(args: Record<string, string | boolean>): void {
  const cred = typeof args.cred === "string" ? args.cred : "";
  const exposure = typeof args.exposure === "string" ? args.exposure : "";
  if (!cred || !exposure) throw new Error("resolve-exposure requires --cred <id> and --exposure <id>");
  const p = securityPaths();
  const state = loadRotationState(p.credRotationStateFile);
  const key = `${cred}:${exposure}`;
  if (state.resolvedExposures[key]) {
    process.stdout.write(`already resolved: ${key} at ${state.resolvedExposures[key].ts}\n`);
    return;
  }
  state.resolvedExposures[key] = {
    ts: new Date().toISOString(),
    detail: typeof args.note === "string" ? args.note : "manually confirmed revoked (resolve-exposure CLI)",
  };
  saveRotationState(p.credRotationStateFile, state);
  process.stdout.write(`resolved: ${key} — the finding clears on the next 3am run\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "resolve-exposure") {
    doResolveExposure(args);
    return;
  }
  if (args.command !== "run") throw new Error(`unknown command: ${String(args.command)} (use: run | resolve-exposure)`);
  const now = typeof args.now === "string" ? args.now : new Date().toISOString();
  const reportDir = typeof args["report-dir"] === "string" ? args["report-dir"] : undefined;

  const base = process.env.CHANGE_MGR_API_BASE ?? "";
  const token = process.env.CHANGE_MGR_M2M_TOKEN ?? "";
  if (!base || !token) throw new Error("CHANGE_MGR_API_BASE and CHANGE_MGR_M2M_TOKEN must be set");
  const client = new ChangeMgrClient(base, token);

  const p = securityPaths();

  const selfCheckFindings = runSelfCheck({
    stateFiles: [p.baselineFile, p.emitStateFile, p.rollbackLog],
    auditLog: p.auditLog,
    hwmFile: p.hwmFile,
    sourceVerifiedFiles: [{ deployed: p.scanPath, source: p.scanSourcePath }],
    integrityFiles: [p.autoFixAllowlistFile, p.fpAllowlistFile],
    hashFile: p.hashFile,
    now,
  });

  // --- Preflight: refuse to run on a scanner whose output contract this parser was not
  // written for. On skew we MUST NOT reach runSecurityDrift's postSync — it posts the full
  // current set and CM reconcile would false-resolve every open item against a garbage parse.
  // Abort with a direct urgent email carrying the skew + this run's trustworthy self-check urgents.
  const skew = scannerVersionGate(p.scanPath, EXPECTED_SCANNER_OUTPUT_VERSION);
  if (skew) {
    const classified: ClassifiedFinding[] = [];
    for (const finding of [skew, ...selfCheckFindings]) {
      const classification = classify(finding, { autoFixAllowlist: readList(p.autoFixAllowlistFile), fpExtra: readList(p.fpAllowlistFile) });
      if (classification) classified.push({ finding, classification });
    }
    const { escalations } = buildEscalations(classified, now);
    const urgent = escalations.filter((e) => e.urgent);
    const emailed = await sendUrgentEmail(urgent, {
      resendApiKey: process.env.RESEND_API_KEY,
      from: process.env.INFRADRIFT_EMAIL_FROM ?? "infra@devonwatkins.com",
      to: process.env.INFRADRIFT_EMAIL_TO ?? "devon.watkins@gmail.com",
    });
    const digest =
      `# Security drift ${now.slice(0, 10)} — ABORTED (scanner output-version skew)\n\n` +
      `🚨 ${skew.detail}\n\n` +
      `Run aborted before parse/sync (reconcile-safe: open items untouched). ` +
      `${urgent.length} urgent item(s), emailed=${emailed}.\n`;
    if (reportDir) {
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, `${now.slice(0, 10)}.security.md`), digest, "utf8");
    }
    process.stdout.write(digest + "\n");
    process.stdout.write(`\nsecurity-drift: ABORTED scanner_version_skew urgent=${urgent.length} emailed=${emailed}\n`);
    process.exit(1);
  }

  // --- WS-0.7 credential-rotation registry: findings + pre-built classifications.
  // A broken registry/state is itself escalated (cred.registry-error → URGENT manual
  // via the taxonomy's deny-by-default cred.* fallback), never silently skipped.
  let credExtraFindings: Finding[] = [];
  let credClassifications: Record<string, Classification> | undefined;
  try {
    const credSpecs = loadCredConsumerFiles(readList(p.credConsumersList));
    const credState = loadRotationState(p.credRotationStateFile);
    credExtraFindings = credFindings(credSpecs, credState, now);
    credClassifications = buildCredClassifications(credSpecs, credState);
  } catch (e) {
    credExtraFindings = [
      {
        severity: "FAIL",
        check: "cred.registry-error",
        target: "cred-consumers",
        detail: `rotation registry unreadable: ${e instanceof Error ? e.message : String(e)}`,
      },
    ];
  }

  const result = await runSecurityDrift(
    {
      scanStdout: captureScan(p.scanPath),
      now,
      autoFixAllowlist: readList(p.autoFixAllowlistFile),
      fpExtra: readList(p.fpAllowlistFile),
      baselineFile: p.baselineFile,
      emitStateFile: p.emitStateFile,
      rollbackLog: p.rollbackLog,
      autoFixCap: Number.parseInt(process.env.SECURITY_AUTOFIX_CAP ?? "10", 10) || 10,
      extraFindings: [...selfCheckFindings, ...credExtraFindings],
      credClassifications,
    },
    {
      postSync: (body) => client.postSync(body),
      sendUrgent: (items) =>
        sendUrgentEmail(items, {
          resendApiKey: process.env.RESEND_API_KEY,
          from: process.env.INFRADRIFT_EMAIL_FROM ?? "infra@devonwatkins.com",
          to: process.env.INFRADRIFT_EMAIL_TO ?? "devon.watkins@gmail.com",
        }),
    },
  );

  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, `${now.slice(0, 10)}.security.md`), result.digest, "utf8");
  }
  process.stdout.write(result.digest + "\n");
  process.stdout.write(`\nsecurity-drift: emitted=${result.emitted} urgent=${result.urgent} emailed=${result.urgentEmailed} autofixed=${result.autoFixed.length} blocked=${result.autoFixBlocked.length} seeded=${result.seeded}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("security-drift-cli.js")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
