#!/usr/bin/env node
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { auditInstance } from "../standards/run-audit.js";
import { applyAction, maxAutoApplies } from "../standards/executor.js";
import { planEscalation } from "../standards/remediation-plan.js";
import { renderRemediationMarkdown } from "../standards/remediation-report.js";
import { runRemediation } from "../standards/run-remediation.js";
import type { DriftReport } from "../standards/report.js";
import type { CoolifyInstance } from "../services/coolify-client.js";

/**
 * Headless remediation pass. Reads the morning drift report for context, re-audits
 * live, auto-applies safe remediations, asks Sonnet to plan the rest, and writes
 * <date>.remediation.json + <date>.remediation.md. Chained after audit-cli in
 * scripts/drift-audit.sh.
 *
 *   node dist/cli/remediate-cli.js --instance prod,dev --report-dir /reports --now <iso>
 *   node dist/cli/remediate-cli.js --instance prod --report-dir /reports --dry-run
 *
 * Exit code: 0 if at least one instance was audited cleanly; 1 if every instance
 * hard-failed (keeps the heartbeat semantics identical to audit-cli).
 */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
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

function loadReport(dir: string, basename: string): DriftReport | null {
  try {
    const p = path.join(dir, basename);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as DriftReport;
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
  const dryRun = args["dry-run"] === true;

  const sourceBasename = `${dateStr}.json`;
  const morning = reportDir ? loadReport(reportDir, sourceBasename) : null;

  // Lazily construct one Anthropic client, reused across plan calls. Tolerant of
  // a missing key: if construction fails, planEscalation gets undefined and
  // raw-falls-back — the model never gates the deterministic safe-apply path.
  let anthropic: Anthropic | undefined;
  const getAnthropic = (): Anthropic | undefined => {
    if (anthropic) return anthropic;
    try {
      anthropic = new Anthropic();
    } catch {
      // no key / bad config — escalations degrade to raw plans
    }
    return anthropic;
  };

  const { report, cleanlyAudited } = await runRemediation(
    instances,
    morning,
    generatedAt,
    sourceBasename,
    {
      audit: (inst) => auditInstance(inst),
      apply: (p, inst, opts) => applyAction(p, inst, opts),
      plan: (p) => planEscalation(p, getAnthropic()),
      maxAutoApplies: maxAutoApplies(),
      dryRun,
    },
  );

  if (reportDir && !dryRun) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, `${dateStr}.remediation.json`), JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(path.join(reportDir, `${dateStr}.remediation.md`), renderRemediationMarkdown(report), "utf-8");
  } else {
    process.stdout.write(renderRemediationMarkdown(report) + "\n");
  }

  process.exit(cleanlyAudited ? 0 : 1);
}

// Only run main() when invoked as a script, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith("remediate-cli.js")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
