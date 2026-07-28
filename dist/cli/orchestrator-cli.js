#!/usr/bin/env node
/**
 * Posts the day's drift digest to the orchestrator's observation spine (WS-P3.0).
 *
 *   node dist/cli/orchestrator-cli.js observe --report-dir /reports --now 2026-07-27T07:00:07Z
 *   node dist/cli/orchestrator-cli.js observe --report-dir /reports --dry-run
 *
 * Fail-open per instance: one instance failing to post never suppresses the other's row, and the
 * run always prints a counted summary line. Exits non-zero if any instance failed, so the caller
 * can log a WARN -- but the caller must keep that non-fatal: the drift loop is never hostage to
 * the orchestrator being reachable.
 */
import fs from 'fs';
import path from 'path';
import { OrchestratorClient } from '../orchestrator/api-client.js';
import { buildObservationSet } from '../orchestrator/observation.js';
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
export function makeClient() {
    const base = process.env.ORCHESTRATOR_API_BASE ?? '';
    const token = process.env.ORCHESTRATOR_M2M_TOKEN ?? '';
    const keyId = process.env.ORCHESTRATOR_CREDENTIAL_KEY_ID ?? 'orchestrator-drift-reporter';
    if (!base)
        throw new Error('ORCHESTRATOR_API_BASE must be set');
    if (!token)
        throw new Error('ORCHESTRATOR_M2M_TOKEN must be set');
    return new OrchestratorClient(base, token, keyId);
}
/** `` unless something was skipped, in which case a leading-space-prefixed `` skipped=N (names)``. */
function skippedClause(skipped) {
    return skipped.length > 0 ? ` skipped=${skipped.length} (${skipped.join(', ')})` : '';
}
/**
 * The counted summary line. Kept as one exported function so a dropped-instance regression (F1)
 * and a client-construction failure (F4) both go through the same, tested formatting -- neither
 * path can silently omit the `skipped=` clause or the count.
 */
export function formatSummaryLine(posted, failed, skipped, total) {
    return `observations: posted=${posted} failed=${failed}${skippedClause(skipped)} of ${total}\n`;
}
/**
 * The follow-up minting pass (WS-P2.8). Uses ORCHESTRATOR_MINT_TOKEN / orchestrator-system --
 * NOT the drift-reporter credential this file's `observe` command uses. That actor's registry
 * profile is observe-and-propose; minting a work unit is canonical mutation, and agent_id
 * attribution is permanent.
 */
export function makeMintClient() {
    const base = process.env.ORCHESTRATOR_API_BASE ?? '';
    const token = process.env.ORCHESTRATOR_MINT_TOKEN ?? '';
    const keyId = process.env.ORCHESTRATOR_MINT_CREDENTIAL_KEY_ID ?? 'orchestrator-system';
    if (!base)
        throw new Error('ORCHESTRATOR_API_BASE must be set');
    if (!token)
        throw new Error('ORCHESTRATOR_MINT_TOKEN must be set');
    return new OrchestratorClient(base, token, keyId);
}
export async function doMintFollowUps(dryRun) {
    if (dryRun) {
        process.stdout.write('follow-ups: would run one minting pass (dry run)\n');
        return;
    }
    let client;
    try {
        client = makeMintClient();
    }
    catch (e) {
        process.stdout.write(`WARN: follow-up mint client unavailable: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = 1;
        return;
    }
    try {
        const result = await client.mintFollowUps(`follow-up-mint:${new Date().toISOString()}`);
        process.stdout.write(`follow-ups: minted=${result.minted.length} skipped=${result.skipped.length} ` +
            `considered=${result.considered}\n`);
    }
    catch (e) {
        process.stdout.write(`WARN: follow-up mint failed: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = 1;
    }
}
export async function doObserve(reportDir, now, dryRun) {
    const date = now.slice(0, 10);
    const file = path.join(reportDir, `${date}.json`);
    const report = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const { commands, skipped } = buildObservationSet(report);
    if (dryRun) {
        for (const command of commands) {
            process.stdout.write(`${JSON.stringify(command, null, 2)}\n`);
        }
        process.stdout.write(`observations: would post ${commands.length}${skippedClause(skipped)} (dry run)\n`);
        return;
    }
    let client;
    try {
        client = makeClient();
    }
    catch (e) {
        // Client construction fails closed (missing/rotated BWS token, BWS outage) *before* the loop
        // that normally prints the counted summary. Without this catch that is a single bare stderr
        // line and no `observations: …` line at all -- the most likely operational failure produces
        // no counted evidence of it. Every command that would have been posted counts as failed.
        process.stdout.write(`WARN: observation client unavailable: ${e instanceof Error ? e.message : String(e)}\n`);
        process.stdout.write(formatSummaryLine(0, commands.length, skipped, commands.length));
        process.exitCode = 1;
        return;
    }
    let posted = 0;
    let failed = 0;
    for (const command of commands) {
        try {
            const response = await client.postObservation(command);
            posted++;
            process.stdout.write(`observed ${command.subject_reference} -> id=${response.id} recorded_by=${response.recorded_by}\n`);
        }
        catch (e) {
            failed++;
            process.stdout.write(`WARN: ${command.subject_reference} observation failed: ${e instanceof Error ? e.message : String(e)}\n`);
        }
    }
    process.stdout.write(formatSummaryLine(posted, failed, skipped, commands.length));
    if (failed > 0)
        process.exitCode = 1;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const now = typeof args.now === 'string' ? args.now : new Date().toISOString();
    const reportDir = typeof args['report-dir'] === 'string' ? args['report-dir'] : undefined;
    if (args.command === 'observe') {
        if (!reportDir)
            throw new Error('observe requires --report-dir');
        await doObserve(reportDir, now, args['dry-run'] === true);
    }
    else if (args.command === 'mint-follow-ups') {
        await doMintFollowUps(args['dry-run'] === true);
    }
    else {
        throw new Error(`unknown command: ${String(args.command)} (use observe or mint-follow-ups)`);
    }
}
if (process.argv[1] && process.argv[1].endsWith('orchestrator-cli.js')) {
    main().catch((e) => {
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
}
//# sourceMappingURL=orchestrator-cli.js.map