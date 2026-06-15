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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== "run") throw new Error(`unknown command: ${String(args.command)} (use: run)`);
  const now = typeof args.now === "string" ? args.now : new Date().toISOString();
  const reportDir = typeof args["report-dir"] === "string" ? args["report-dir"] : undefined;

  const base = process.env.CHANGE_MGR_API_BASE ?? "";
  const token = process.env.CHANGE_MGR_M2M_TOKEN ?? "";
  if (!base || !token) throw new Error("CHANGE_MGR_API_BASE and CHANGE_MGR_M2M_TOKEN must be set");
  const client = new ChangeMgrClient(base, token);

  const p = securityPaths();

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
