#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { ChangeMgrClient } from '../change-manager/api-client.js';
import { runChangeAgent } from '../change-manager/agent.js';
import { runWindow, selectItems, } from '../change-manager/run-window.js';
import { renderWindowMarkdown } from '../change-manager/window-report.js';
export function parseArgs(argv) {
    const args = {};
    if (argv[0] && !argv[0].startsWith('--'))
        args.command = argv[0];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--'))
            continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            args[key] = next;
            i++;
        }
        else
            args[key] = true;
    }
    return args;
}
function client(actor = 'executor') {
    const base = process.env.CHANGE_MGR_API_BASE ?? '';
    const token = process.env.CHANGE_MGR_M2M_TOKEN ?? '';
    if (!base || !token)
        throw new Error('CHANGE_MGR_API_BASE and CHANGE_MGR_M2M_TOKEN must be set');
    return new ChangeMgrClient(base, token, actor);
}
async function doSync(reportDir, now) {
    const date = now.slice(0, 10);
    const file = path.join(reportDir, `${date}.remediation.json`);
    const report = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const summary = await client().postSync({
        generated_at: now,
        source_report: `${date}.remediation.json`,
        escalations: report.escalations ?? [],
    });
    process.stdout.write(`synced: ${JSON.stringify(summary)}\n`);
}
/** `--instance prod|dev`; absent keeps both instances. Throws on any other value or no value. */
export function parseInstance(value) {
    if (value === undefined)
        return undefined;
    if (value === 'prod' || value === 'dev')
        return value;
    if (value === true)
        throw new Error('--instance needs a value: prod or dev');
    throw new Error(`--instance needs prod or dev, got: ${value}`);
}
/** `--dry-run` is a bare flag; a value after it is a mistyped command, not a dry run. */
export function parseDryRun(value) {
    if (value === undefined)
        return false;
    if (value === true)
        return true;
    throw new Error(`--dry-run takes no value, got: ${value}`);
}
/**
 * Runs the change window. `makeAgent` is called only for a real run, so a dry run needs no
 * Anthropic key. A dry run lists approved items, applies the same selection, prints the ids it
 * would claim as one JSON line, and changes nothing.
 */
export async function doRunWindow(c, makeAgent, opts) {
    const maxChangesPerWindow = Number.parseInt(process.env.MAX_CHANGES_PER_WINDOW ?? '5', 10) || 5;
    if (opts.dryRun) {
        const selected = selectItems(await c.getApproved(), {
            maxChangesPerWindow,
            instance: opts.instance,
        });
        const line = {
            dry_run: true,
            instance: opts.instance ?? null,
            would_claim: selected.map((i) => i.id),
        };
        process.stdout.write(JSON.stringify(line) + '\n');
        return;
    }
    const runAgent = makeAgent();
    const wr = await c.startWindow(opts.now);
    const summary = await runWindow({
        getApproved: () => c.getApproved(),
        claim: async (id) => {
            await c.claim(id);
        },
        runAgent,
        postOutcome: async (id, body) => {
            await c.postOutcome(id, body);
        },
        maxChangesPerWindow,
        instance: opts.instance,
    });
    const md = renderWindowMarkdown(opts.now, summary);
    await c.finishWindow(wr.id, {
        status: 'done',
        considered: summary.considered,
        applied: summary.applied,
        failed: summary.failed,
        blocked: summary.blocked,
        skipped: summary.skipped,
        report_md: md,
    });
    if (opts.reportDir)
        fs.writeFileSync(path.join(opts.reportDir, `${opts.now.slice(0, 10)}.change-window.md`), md, 'utf-8');
    process.stdout.write(md + '\n');
}
function anthropicAgent() {
    const anthropic = new Anthropic();
    return (item) => runChangeAgent(item, { client: anthropic });
}
export async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const now = typeof args.now === 'string' ? args.now : new Date().toISOString();
    const reportDir = typeof args['report-dir'] === 'string' ? args['report-dir'] : undefined;
    if (args.command === 'sync') {
        if (!reportDir)
            throw new Error('sync requires --report-dir');
        await doSync(reportDir, now);
    }
    else if (args.command === 'run-window') {
        // Validate every flag before client(), so a bad flag fails before any network call.
        const opts = {
            reportDir,
            now,
            instance: parseInstance(args.instance),
            dryRun: parseDryRun(args['dry-run']),
        };
        await doRunWindow(client('change-window-agent'), anthropicAgent, opts);
    }
    else {
        throw new Error(`unknown command: ${String(args.command)} (use sync | run-window)`);
    }
}
if (process.argv[1] && process.argv[1].endsWith('change-mgr-cli.js')) {
    main().catch((e) => {
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
}
//# sourceMappingURL=change-mgr-cli.js.map