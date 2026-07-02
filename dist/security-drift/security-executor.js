// The 4am verbatim security executor. Runs APPROVED security items as EXACT commands
// (no LLM), gated by a plan-hash integrity check anchored in the Mac-side emit-state.
//
// This is the lethal-trifecta control: drift data → human approval → a pre-vetted
// deterministic command. There is no model in this write path. A plan whose hash does
// not match the one recorded when it was emitted is REFUSED (possible tamper between
// approval and execution) and raised as an alert.
import { execFileSync } from "node:child_process";
import { planHash } from "./canonical.js";
import { loadEmitState } from "./emit-state.js";
import { runRotationPlan } from "./rotation-executor.js";
function defaultExec(timeoutMs) {
    return (cmd) => {
        try {
            const out = execFileSync(cmd[0], cmd.slice(1), { shell: false, timeout: timeoutMs, encoding: "utf8" });
            return { ok: true, detail: String(out).slice(0, 500) };
        }
        catch (e) {
            return { ok: false, detail: `exit ${e?.status ?? "?"}: ${(e?.stderr || e?.message || "").toString().slice(0, 500)}` };
        }
    };
}
export async function runSecurityWindow(deps) {
    const summary = { considered: 0, applied: 0, failed: 0, blocked: 0, skipped: 0, results: [] };
    const items = (await deps.getApprovedSecurity()).slice(0, deps.maxChanges);
    if (!items.length)
        return summary;
    // The emit-state read itself validates the trust boundary (0600/owner). If it is
    // tampered, refuse the whole batch rather than trusting any recorded hash.
    let emitState;
    try {
        emitState = loadEmitState(deps.emitStateFile);
    }
    catch (e) {
        for (const item of items) {
            summary.considered++;
            summary.blocked++;
            const reason = `emit-state integrity failure: ${e instanceof Error ? e.message : String(e)}`;
            summary.results.push({ name: item.resource_name, outcome: "blocked", detail: reason });
            await deps.onIntegrityFailure(item, reason).catch(() => { });
        }
        return summary;
    }
    const exec = deps.exec ?? defaultExec(deps.timeoutMs ?? 60_000);
    for (const item of items) {
        summary.considered++;
        try {
            await deps.claim(item.id); // 409 if no longer approved → skip
        }
        catch {
            summary.skipped++;
            summary.results.push({ name: item.resource_name, outcome: "skipped", detail: "claim failed (already claimed?)" });
            continue;
        }
        // --- INTEGRITY GATE ---
        const recorded = emitState[item.resource_uuid];
        const computed = planHash(item.plan);
        if (!recorded || recorded.hash !== computed) {
            const reason = recorded
                ? "plan integrity check FAILED — plan hash does not match the value recorded at emit time (possible tamper)"
                : "no recorded plan hash for this item — refusing to execute an unverified plan";
            summary.blocked++;
            summary.results.push({ name: item.resource_name, outcome: "blocked", detail: reason });
            await deps.postOutcome(item.id, { outcome: "blocked", detail: reason }).catch(() => { });
            await deps.onIntegrityFailure(item, reason).catch(() => { });
            continue;
        }
        const remediation = (item.plan?.remediation ?? {});
        // Credential-rotation plans (WS-0.7): typed steps run by the rotation executor
        // (store → deploy → verify → revoke-confirm), same plan-hash gate as exec plans.
        if (remediation.rotation && typeof remediation.rotation === "object") {
            if (!deps.rotation) {
                summary.blocked++;
                const detail = "rotation deps unavailable in this runner — cannot execute rotation plan";
                summary.results.push({ name: item.resource_name, outcome: "blocked", detail });
                await deps.postOutcome(item.id, { outcome: "blocked", detail }).catch(() => { });
                continue;
            }
            const r = await runRotationPlan(remediation.rotation, deps.rotation);
            if (r.outcome === "done")
                summary.applied++;
            else if (r.outcome === "failed")
                summary.failed++;
            else
                summary.blocked++;
            summary.results.push({ name: item.resource_name, outcome: r.outcome, detail: r.detail });
            await deps.postOutcome(item.id, { outcome: r.outcome, detail: r.detail }).catch(() => { });
            continue;
        }
        // manual remediations are tracked, never executed.
        if (Array.isArray(remediation.manual) || !Array.isArray(remediation.exec)) {
            summary.blocked++;
            const detail = "manual remediation — needs human action (not auto-executed)";
            summary.results.push({ name: item.resource_name, outcome: "blocked", detail });
            await deps.postOutcome(item.id, { outcome: "blocked", detail }).catch(() => { });
            continue;
        }
        // --- VERBATIM EXECUTION (no shell, array args) ---
        const details = [];
        let failed = false;
        for (const cmd of remediation.exec) {
            if (!Array.isArray(cmd) || cmd.length === 0 || cmd.some((a) => typeof a !== "string")) {
                failed = true;
                details.push(`malformed command: ${JSON.stringify(cmd)}`);
                break;
            }
            const r = exec(cmd);
            details.push(`${cmd.join(" ")} → ${r.ok ? "ok" : r.detail}`);
            if (!r.ok) {
                failed = true;
                break;
            }
        }
        const outcome = failed ? "failed" : "done";
        if (failed)
            summary.failed++;
        else
            summary.applied++;
        const detail = details.join(" | ");
        summary.results.push({ name: item.resource_name, outcome, detail });
        await deps.postOutcome(item.id, { outcome, detail }).catch(() => { });
    }
    return summary;
}
//# sourceMappingURL=security-executor.js.map