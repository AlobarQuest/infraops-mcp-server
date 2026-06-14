#!/usr/bin/env node
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { ChangeMgrClient } from "../change-manager/api-client.js";
import { runChangeAgent } from "../change-manager/agent.js";
import { runWindow } from "../change-manager/run-window.js";
import { renderWindowMarkdown } from "../change-manager/window-report.js";
export function parseArgs(argv) {
    const args = {};
    if (argv[0] && !argv[0].startsWith("--"))
        args.command = argv[0];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--"))
            continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            args[key] = next;
            i++;
        }
        else
            args[key] = true;
    }
    return args;
}
function client() {
    const base = process.env.CHANGE_MGR_API_BASE ?? "";
    const token = process.env.CHANGE_MGR_M2M_TOKEN ?? "";
    if (!base || !token)
        throw new Error("CHANGE_MGR_API_BASE and CHANGE_MGR_M2M_TOKEN must be set");
    return new ChangeMgrClient(base, token);
}
async function doSync(reportDir, now) {
    const date = now.slice(0, 10);
    const file = path.join(reportDir, `${date}.remediation.json`);
    const report = JSON.parse(fs.readFileSync(file, "utf-8"));
    const summary = await client().postSync({ generated_at: now, source_report: `${date}.remediation.json`, escalations: report.escalations ?? [] });
    process.stdout.write(`synced: ${JSON.stringify(summary)}\n`);
}
async function doRunWindow(reportDir, now) {
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
    if (reportDir)
        fs.writeFileSync(path.join(reportDir, `${now.slice(0, 10)}.change-window.md`), md, "utf-8");
    process.stdout.write(md + "\n");
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const now = typeof args.now === "string" ? args.now : new Date().toISOString();
    const reportDir = typeof args["report-dir"] === "string" ? args["report-dir"] : undefined;
    if (args.command === "sync") {
        if (!reportDir)
            throw new Error("sync requires --report-dir");
        await doSync(reportDir, now);
    }
    else if (args.command === "run-window") {
        await doRunWindow(reportDir, now);
    }
    else {
        throw new Error(`unknown command: ${String(args.command)} (use sync | run-window)`);
    }
}
if (process.argv[1] && process.argv[1].endsWith("change-mgr-cli.js")) {
    main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
//# sourceMappingURL=change-mgr-cli.js.map