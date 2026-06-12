#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { auditInstance } from "../standards/run-audit.js";
import { buildDriftReport, renderMarkdown, wasCleanlyAudited } from "../standards/report.js";
import type { DriftReport } from "../standards/report.js";
import type { CoolifyInstance } from "../services/coolify-client.js";

/**
 * Headless drift audit. Runs `coolify_audit_standards` for one or more instances,
 * writes a structured JSON report + day-over-day delta + a human markdown summary,
 * and prints JSON to stdout. Designed to be run by cron (see docker/audit-entrypoint.sh).
 *
 *   node dist/cli/audit-cli.js --instance prod,dev --report-dir /reports
 *   node dist/cli/audit-cli.js --instance prod --stdout
 *
 * Exit code: 0 if at least one instance was audited; 1 only if every instance
 * hard-failed (so the heartbeat is not pinged on a wholly broken run).
 */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function loadPreviousReport(dir: string, todayBasename: string): DriftReport | null {
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f !== todayBasename)
      .sort();
    const last = files.pop();
    if (!last) return null;
    return JSON.parse(fs.readFileSync(path.join(dir, last), "utf-8")) as DriftReport;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const instances = String(args.instance ?? "prod")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as CoolifyInstance[];

  const reportDir = typeof args["report-dir"] === "string" ? (args["report-dir"] as string) : undefined;
  const generatedAt = typeof args.now === "string" ? (args.now as string) : new Date().toISOString();
  const dateStr = generatedAt.slice(0, 10);
  const toStdout = args.stdout === true || !reportDir;

  const prev = reportDir ? loadPreviousReport(reportDir, `${dateStr}.json`) : null;

  const report = await buildDriftReport(instances, (inst) => auditInstance(inst), prev, generatedAt);

  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, `${dateStr}.json`), JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(path.join(reportDir, `${dateStr}.md`), renderMarkdown(report), "utf-8");
  }
  if (toStdout) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }

  // Exit non-zero unless at least one instance was audited cleanly. This trips the
  // heartbeat on a wholly broken run — e.g. missing tokens make every read error
  // out, which must NOT look like a healthy "0 deviations".
  process.exit(wasCleanlyAudited(report) ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
