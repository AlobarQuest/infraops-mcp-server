#!/usr/bin/env node
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { ChangeMgrClient } from "../change-manager/api-client.js";
import { runChangeAgent } from "../change-manager/agent.js";
import { runWindow } from "../change-manager/run-window.js";
import { renderWindowMarkdown } from "../change-manager/window-report.js";
import { runSecurityWindow } from "../security-drift/security-executor.js";
import { securityPaths } from "../security-drift/paths.js";
import { sendAlertEmail } from "../security-drift/notify.js";
import { defaultRotationDeps } from "../security-drift/rotation-executor.js";
import { loadRotationState, saveRotationState } from "../security-drift/cred-rotation.js";
import { coolifyGet, coolifyPatch } from "../services/coolify-client.js";

export function parseArgs(argv: string[]): Record<string, string | boolean> {
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

function client(): ChangeMgrClient {
  const base = process.env.CHANGE_MGR_API_BASE ?? "";
  const token = process.env.CHANGE_MGR_M2M_TOKEN ?? "";
  if (!base || !token) throw new Error("CHANGE_MGR_API_BASE and CHANGE_MGR_M2M_TOKEN must be set");
  return new ChangeMgrClient(base, token);
}

async function doSync(reportDir: string, now: string): Promise<void> {
  const date = now.slice(0, 10);
  const file = path.join(reportDir, `${date}.remediation.json`);
  const report = JSON.parse(fs.readFileSync(file, "utf-8")) as { escalations: unknown[] };
  const summary = await client().postSync({ generated_at: now, source_report: `${date}.remediation.json`, escalations: report.escalations ?? [] });
  process.stdout.write(`synced: ${JSON.stringify(summary)}\n`);
}

async function doRunWindow(reportDir: string | undefined, now: string): Promise<void> {
  const c = client();
  const anthropic = new Anthropic();
  const wr = await c.startWindow(now);
  const summary = await runWindow({
    getApproved: () => c.getApproved(),
    claim: async (id) => { await c.claim(id); },
    runAgent: (item) => runChangeAgent(item, { client: anthropic }),
    postOutcome: async (id, body) => { await c.postOutcome(id, body); },
    maxChangesPerWindow: Number.parseInt(process.env.MAX_CHANGES_PER_WINDOW ?? "5", 10) || 5,
  });
  await c.finishWindow(wr.id, { status: "done", considered: summary.considered, applied: summary.applied,
    failed: summary.failed, blocked: summary.blocked, skipped: summary.skipped,
    report_md: renderWindowMarkdown(now, summary) });
  const md = renderWindowMarkdown(now, summary);
  if (reportDir) fs.writeFileSync(path.join(reportDir, `${now.slice(0, 10)}.change-window.md`), md, "utf-8");
  process.stdout.write(md + "\n");
}

async function doRunSecurityWindow(reportDir: string | undefined, now: string): Promise<void> {
  const c = client();
  const p = securityPaths();
  const notifyDeps = {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.INFRADRIFT_EMAIL_FROM ?? "infra@devonwatkins.com",
    to: process.env.INFRADRIFT_EMAIL_TO ?? "devon.watkins@gmail.com",
  };
  const summary = await runSecurityWindow({
    getApprovedSecurity: () => c.getApprovedBySource("security"),
    claim: async (id) => { await c.claim(id); },
    postOutcome: async (id, body) => { await c.postOutcome(id, body); },
    onIntegrityFailure: async (item, reason) => {
      await sendAlertEmail("🚨 Security executor REFUSED a plan (integrity)", `${item.resource_name} (item ${item.id}): ${reason}`, notifyDeps);
    },
    emitStateFile: p.emitStateFile,
    maxChanges: Number.parseInt(process.env.SECURITY_MAX_CHANGES ?? "10", 10) || 10,
    rotation: defaultRotationDeps({
      coolifyGet: (pth, instance) => coolifyGet(pth, undefined, (instance ?? "prod") as "prod" | "dev"),
      coolifyPatch: (pth, body, instance) =>
        coolifyPatch(pth, body as Record<string, unknown>, (instance ?? "prod") as "prod" | "dev"),
      loadState: () => loadRotationState(p.credRotationStateFile),
      saveState: (s) => saveRotationState(p.credRotationStateFile, s),
      now,
    }),
  });
  const lines = [
    `# Security window — ${now}`,
    `**${summary.applied} applied**, ${summary.blocked} blocked, ${summary.failed} failed, ${summary.skipped} skipped (of ${summary.considered}).`,
    ...summary.results.map((r) => `- ${r.outcome === "done" ? "✅" : r.outcome === "blocked" ? "🚫" : r.outcome === "failed" ? "❌" : "⏭️"} **${r.name}** — ${r.outcome}: ${r.detail}`),
  ];
  const md = lines.join("\n");
  if (reportDir) fs.writeFileSync(path.join(reportDir, `${now.slice(0, 10)}.security-window.md`), md, "utf-8");
  process.stdout.write(md + "\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = typeof args.now === "string" ? args.now : new Date().toISOString();
  const reportDir = typeof args["report-dir"] === "string" ? (args["report-dir"] as string) : undefined;
  if (args.command === "sync") {
    if (!reportDir) throw new Error("sync requires --report-dir");
    await doSync(reportDir, now);
  } else if (args.command === "run-window") {
    await doRunWindow(reportDir, now);
  } else if (args.command === "run-security-window") {
    await doRunSecurityWindow(reportDir, now);
  } else {
    throw new Error(`unknown command: ${String(args.command)} (use sync | run-window | run-security-window)`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("change-mgr-cli.js")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
