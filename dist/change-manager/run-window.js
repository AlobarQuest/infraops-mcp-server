/**
 * The window executor core. Pulls approved items, claims each (skipping on a 409/claim error),
 * runs the agent, posts the outcome. Per-item isolation; capped at maxChangesPerWindow.
 */
export async function runWindow(deps) {
    const approved = (await deps.getApproved()).slice(0, deps.maxChangesPerWindow);
    const summary = { considered: 0, applied: 0, failed: 0, blocked: 0, skipped: 0, results: [] };
    for (const item of approved) {
        summary.considered++;
        try {
            await deps.claim(item.id); // 409 if no longer approved → skip
        }
        catch {
            summary.skipped++;
            summary.results.push({ name: item.resource_name, outcome: "skipped", detail: "claim failed (already claimed?)" });
            continue;
        }
        let outcome;
        try {
            outcome = await deps.runAgent(item);
        }
        catch (e) {
            outcome = { outcome: "failed", detail: e instanceof Error ? e.message : String(e), rollback: {}, tool_calls: { calls: [] } };
        }
        if (outcome.outcome === "done")
            summary.applied++;
        else if (outcome.outcome === "blocked")
            summary.blocked++;
        else if (outcome.outcome === "skipped_conformant")
            summary.skipped++;
        else
            summary.failed++;
        const result = { name: item.resource_name, outcome: outcome.outcome, detail: outcome.detail };
        summary.results.push(result);
        try {
            await deps.postOutcome(item.id, {
                outcome: outcome.outcome, detail: outcome.detail,
                tool_calls: outcome.tool_calls, rollback: outcome.rollback,
            });
        }
        catch (e) {
            // Recording the outcome failed (transient API error). The change itself already
            // happened; don't abort the batch — note it on the item so the digest surfaces it.
            result.detail += ` [WARN: outcome post failed: ${e instanceof Error ? e.message : String(e)}]`;
        }
    }
    return summary;
}
//# sourceMappingURL=run-window.js.map