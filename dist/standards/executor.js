import { coolifyGet, coolifyPatch } from "../services/coolify-client.js";
export const SAFE_TOOLS = {
    coolify_update_application: {
        fetch: (args, instance) => coolifyGet(`/applications/${args.uuid}`, undefined, instance),
        apply: (args, instance) => {
            const { uuid, ...fields } = args;
            return coolifyPatch(`/applications/${uuid}`, fields, instance);
        },
    },
};
/** True if applying `args` would actually change the resource (uuid is the selector, not a field). */
export function wouldChange(current, args) {
    for (const [k, v] of Object.entries(args)) {
        if (k === "uuid")
            continue;
        if (current[k] !== v)
            return true;
    }
    return false;
}
/** The four-gate check: only safe, high-confidence, whitelisted remediations may auto-apply. */
export function isAutoApplicable(p) {
    return (p.kind === "remediation" &&
        p.risk === "safe" &&
        p.confidence === "high" &&
        p.planned_action !== null &&
        Object.prototype.hasOwnProperty.call(SAFE_TOOLS, p.planned_action.tool));
}
/** Read MAX_AUTO_APPLIES from env (positive integer); default 20. The runaway guard ceiling. */
export function maxAutoApplies() {
    const raw = process.env.MAX_AUTO_APPLIES;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isInteger(n) && n > 0 ? n : 20;
}
/**
 * Apply one safe remediation. Re-reads live state first: skips if already
 * conformant (idempotent), previews under dryRun, applies otherwise. Never
 * throws — a client failure is captured as status "failed" so the batch
 * continues. Defense in depth: a non-auto-applicable proposal is refused
 * without any network call.
 */
export async function applyAction(p, instance, opts = {}) {
    const base = {
        proposal_id: p.id,
        target: p.target,
        tool: p.planned_action?.tool ?? "",
        args: p.planned_action?.args ?? {},
    };
    if (!isAutoApplicable(p)) {
        return { ...base, status: "failed", detail: "not auto-applicable (gate failed)" };
    }
    const tool = SAFE_TOOLS[p.planned_action.tool];
    const args = p.planned_action.args;
    try {
        const current = await tool.fetch(args, instance);
        if (!wouldChange(current, args)) {
            return { ...base, status: "skipped", detail: "already conformant" };
        }
        if (opts.dryRun) {
            return { ...base, status: "skipped", detail: "dry-run (would apply)" };
        }
        await tool.apply(args, instance);
        return { ...base, status: "applied", detail: "applied successfully" };
    }
    catch (e) {
        return { ...base, status: "failed", detail: e instanceof Error ? e.message : String(e) };
    }
}
/**
 * Pre-apply gate for safe remediations that could misfire. Currently only the
 * health-check enable: a Coolify health check pointed at /api/health is only safe
 * to auto-enable if the app already passes its Docker healthcheck (live status
 * running:healthy → it serves a working health endpoint). Otherwise the new check
 * could mark a working-but-non-conforming app unhealthy, so the proposal is
 * rerouted to escalation (a Sonnet plan) instead of auto-applied. Remediations
 * with no gate return ok without a network call.
 *
 * Keyed on the remediation_key (the proposal id prefix), not the tool name, so it
 * gates *only* enable_healthcheck — never some future safe use of the same tool.
 * Fails closed: an unreadable status escalates rather than applies.
 */
export async function verifySafe(p, instance) {
    const remediationKey = p.id.split(":")[0];
    if (remediationKey !== "coolify.enable_healthcheck") {
        return { ok: true, reason: "no health-path gate for this remediation" };
    }
    try {
        const app = await coolifyGet(`/applications/${p.target.uuid}`, undefined, instance);
        const status = String(app.status ?? "");
        const health = status.split(":")[1] ?? "";
        if (health === "healthy") {
            return { ok: true, reason: "running:healthy (Docker healthcheck passing — serves its health path)" };
        }
        return {
            ok: false,
            reason: `status '${status || "unknown"}' is not running:healthy — the app may not serve /api/health, ` +
                `so auto-enabling the check could mark it unhealthy. Confirm the health path/port, then enable manually.`,
        };
    }
    catch (e) {
        return { ok: false, reason: `could not verify live status: ${e instanceof Error ? e.message : String(e)}` };
    }
}
//# sourceMappingURL=executor.js.map