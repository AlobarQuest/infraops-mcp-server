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
const PROBE_TIMEOUT_MS = 5000;
/**
 * Default probe: GET with a hard timeout. Redirects are NOT followed — an SSO/forward-auth
 * 302 must read as "not a 2xx health response" (→ escalate), never silently resolve to a
 * login page that returns 200. A network error/timeout yields status=null.
 */
export async function probeHealthPath(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal });
        // An opaqueredirect (manual redirect) reports status 0 — surface it as a redirect, not "HTTP 0".
        const status = res.status === 0 ? 302 : res.status;
        return { status, reason: res.status === 0 ? "redirect (no direct 2xx — likely auth/SSO)" : `HTTP ${res.status}` };
    }
    catch (e) {
        return { status: null, reason: e instanceof Error ? e.message : String(e) };
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Build the public health-probe URL: the first FQDN (https-normalized, trailing slash
 * stripped) + the path. Returns null when there is no FQDN to probe.
 */
export function buildHealthProbeUrl(fqdn, path) {
    const first = String(fqdn ?? "").split(",")[0].trim();
    if (!first)
        return null;
    const base = /^https?:\/\//i.test(first) ? first : `https://${first}`;
    return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);
}
/**
 * Pre-apply gate for safe remediations that could misfire. Currently only the health-check
 * enable: enabling a Coolify health check on an app that does not actually serve the health
 * path would mark a working app unhealthy. We verify by HTTP-probing the app's PUBLIC health
 * path — the exact path the remediation will set (so probe and config can never disagree).
 * A 2xx means the app serves it → safe to auto-enable. Anything else (redirect/SSO, 4xx/5xx,
 * timeout, or no FQDN) reroutes the proposal to escalation with a reason, where a human
 * confirms the path and enables manually.
 *
 * This replaces the old running:healthy gate, which was a chicken-and-egg trap: an app can't
 * report running:healthy until it already has a passing health check, so no app missing one
 * could ever auto-remediate.
 *
 * Keyed on the remediation_key (the proposal id prefix), so it gates *only* enable_healthcheck.
 * Fails closed: an unreadable app, a missing FQDN, or a non-2xx probe escalates rather than applies.
 * `deps` is injectable for tests; production uses the real client + probe.
 */
export async function verifySafe(p, instance, deps = {}) {
    const remediationKey = p.id.split(":")[0];
    if (remediationKey !== "coolify.enable_healthcheck") {
        return { ok: true, reason: "no health-path gate for this remediation" };
    }
    const get = deps.get ?? coolifyGet;
    const probe = deps.probe ?? probeHealthPath;
    // Probe the SAME path the remediation will enable (registry sets it per build_pack).
    const path = String(p.planned_action?.args?.health_check_path ?? "/api/health");
    let app;
    try {
        app = await get(`/applications/${p.target.uuid}`, undefined, instance);
    }
    catch (e) {
        return { ok: false, reason: `could not read app to probe: ${e instanceof Error ? e.message : String(e)}` };
    }
    const url = buildHealthProbeUrl(app.fqdn, path);
    if (!url) {
        return { ok: false, reason: `app has no FQDN to probe ${path} — confirm the health path and enable manually` };
    }
    const r = await probe(url, PROBE_TIMEOUT_MS);
    if (r.status !== null && r.status >= 200 && r.status < 300) {
        return { ok: true, reason: `probe ${url} → HTTP ${r.status} (serves its health path; safe to auto-enable)` };
    }
    return {
        ok: false,
        reason: `probe ${url} → ${r.reason} (not 2xx — may be SSO-protected or serve a non-standard path; enable manually)`,
    };
}
//# sourceMappingURL=executor.js.map