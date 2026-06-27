import axios from "axios";
/** Parse a bare host from a URL. http/https only; reject userinfo; return the lowercased hostname
 *  (no port); null on any invalid/unsafe input. Coolify app fields are not a trust boundary. */
export function hostFromUrl(url) {
    if (typeof url !== "string" || url.trim() === "")
        return null;
    let parsed;
    try {
        parsed = new URL(url.trim());
    }
    catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return null;
    if (parsed.username || parsed.password)
        return null;
    const host = parsed.hostname.toLowerCase();
    return host === "" ? null : host;
}
const isNonEmpty = (v) => typeof v === "string" && v.trim() !== "";
/**
 * App-conformance iff the probe got a concrete client-error status that signals a path/route
 * problem the app must fix in code: 4xx excluding auth (401/403). Everything else — timeout
 * (null), 3xx redirect / SSO, 401/403 auth, 5xx server error — is infra/retry, NOT app-conformance.
 */
export function classifyLane(probe) {
    const s = probe?.status;
    if (s !== undefined && s !== null && s >= 400 && s < 500 && s !== 401 && s !== 403) {
        return "app-conformance";
    }
    return "infra-config";
}
export function buildHandoffPackage(args) {
    const { repo, targetBranch, rule, path, url, probeReason } = args;
    // repo and branch travel together: if either is missing/unconfirmed, BOTH are UNCONFIRMED —
    // a half-confirmed dispatch target must be unrepresentable (panel MED-5 / HIGH-1).
    const confirmed = isNonEmpty(repo) && repo !== "UNCONFIRMED" && isNonEmpty(targetBranch) && targetBranch !== "UNCONFIRMED";
    const finalRepo = confirmed ? repo : "UNCONFIRMED";
    const finalBranch = confirmed ? targetBranch : "UNCONFIRMED";
    const target = url ?? `https://<fqdn>${path}`;
    return {
        repo: finalRepo,
        target_branch: finalBranch,
        rule,
        verified_gap: `Probe ${target} → ${probeReason}; the app does not serve the standard health path ${path}. The infra health-check enable was correctly held by the probe-guard.`,
        required_change: `In repo ${finalRepo}${finalRepo === "UNCONFIRMED" ? " — confirm before dispatch" : ""} (branch ${finalBranch}): add a handler serving ${path} returning 2xx (mirror the app's existing health response). Keep any existing health path working.`,
        acceptance_check: `GET ${target} returns 2xx. Once it does, the next drift scan's probe-guard passes and the infra health-check auto-enables; the change-manager item then auto-resolves.`,
        scope_guard: "App repo only. Open a PR; do NOT deploy. Do NOT use any infra/Coolify/secret tools.",
        do_nots: [
            "Do NOT hand-resolve or wontfix the change-manager item.",
            "Do NOT touch Coolify config or enable the health check manually.",
            "Do NOT change unrelated routes.",
        ],
    };
}
/** Render the human copy/paste markdown FROM the structured package (so the two cannot drift). */
export function renderHandoffBrief(pkg) {
    return [
        `# Handoff brief: ${pkg.repo}${pkg.repo === "UNCONFIRMED" ? " — confirm before dispatch" : ""}`,
        "",
        "**Lane:** app-conformance — the fix is an application code change, not infra config.",
        "",
        "## Source",
        `change-manager drift item, rule \`${pkg.rule}\` (target branch \`${pkg.target_branch}\`).`,
        "",
        "## Verified gap",
        pkg.verified_gap,
        "",
        "## Required change",
        pkg.required_change,
        "",
        "## Acceptance check",
        pkg.acceptance_check,
        "",
        "## Scope guard",
        pkg.scope_guard,
        "",
        "## Do-nots",
        ...pkg.do_nots.map((d) => `- ${d}`),
        "",
    ].join("\n");
}
/** Classify a probe-guard hold and, when app-conformance, build the structured package + rendered brief. */
export async function buildHandoff(proposal, probe, url, instance, deps = {}) {
    const lane = classifyLane(probe);
    if (lane !== "app-conformance")
        return { lane: "infra-config" };
    const path = String(proposal.planned_action?.args?.health_check_path ?? "/api/health");
    // Authoritative resolution via app-brain. PRIMARY key = the stable Coolify app UUID
    // (proposal.target.uuid); FALLBACK = the host from the probe URL. Never the resource_name.
    const coolifyAppUuid = String(proposal.target.uuid ?? "");
    const fqdn = hostFromUrl(url);
    let repo = null;
    let targetBranch = null;
    if (deps.appBrainResolve) {
        try {
            const r = await deps.appBrainResolve({ coolifyAppUuid, fqdn });
            if (r === null) {
                console.info(`[handoff] no app-brain match (uuid=${coolifyAppUuid} fqdn=${fqdn ?? "—"}) → UNCONFIRMED`);
            }
            else if (isNonEmpty(r.github_repo) && isNonEmpty(r.branch)) {
                repo = r.github_repo;
                targetBranch = r.branch;
            }
            else {
                console.warn(`[handoff] app-brain matched (name=${r.name}) but repo/branch incomplete (repo=${r.github_repo ?? "null"} branch=${r.branch ?? "null"}) → UNCONFIRMED`);
            }
        }
        catch (e) {
            const status = axios.isAxiosError(e) ? e.response?.status : undefined;
            if (status === 401 || status === 403) {
                console.error(`[handoff] app-brain auth rejected (HTTP ${status}) — check APPBRAIN_ACCESS_KEY → UNCONFIRMED`);
            }
            else {
                console.error(`[handoff] app-brain resolver unreachable (${e instanceof Error ? e.message : String(e)}) → UNCONFIRMED`);
            }
        }
    }
    else {
        console.info("[handoff] no app-brain resolver configured → UNCONFIRMED");
    }
    const rule = proposal.id.split(":")[0];
    const handoff = buildHandoffPackage({ repo, targetBranch, rule, path, url: url ?? null, probeReason: probe?.reason ?? "non-2xx" });
    return { lane, handoff, handoff_brief: renderHandoffBrief(handoff) };
}
//# sourceMappingURL=handoff-brief.js.map