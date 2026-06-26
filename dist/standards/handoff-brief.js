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
/** Derive the target repo from resource_name (`<owner>/<repo>:<branch>` → `<repo>`), optionally
 * cross-checked with app-brain. Returns `{repo:null}` when it cannot be resolved confidently. */
export async function resolveRepo(resourceName, deps = {}) {
    const noBranch = String(resourceName ?? "").trim().split(":")[0];
    const candidate = noBranch.includes("/") ? (noBranch.split("/").pop() ?? "").trim() : "";
    if (!candidate)
        return { repo: null, confirmed: false };
    if (deps.appBrainLookup) {
        let confirmed = false;
        try {
            confirmed = await deps.appBrainLookup(candidate);
        }
        catch {
            confirmed = false;
        }
        return confirmed ? { repo: candidate, confirmed: true } : { repo: null, confirmed: false };
    }
    return { repo: candidate, confirmed: false };
}
export function generateHandoffBrief(args) {
    const { repo, resourceName, instance, path, url, probeReason } = args;
    const repoLine = repo ?? "UNCONFIRMED — confirm before dispatch";
    const target = url ?? `https://<fqdn>${path}`;
    return [
        `# Handoff brief: ${repoLine}`,
        "",
        "**Lane:** app-conformance — the fix is an application code change, not infra config.",
        "",
        "## Source",
        `change-manager drift item for \`${resourceName}\` (${instance}), rule \`coolify.enable_healthcheck\`.`,
        "",
        "## Verified gap",
        `Probe of \`${target}\` → ${probeReason}. The app does not serve the project-standard health`,
        `path \`${path}\`. The infra health-check enable was correctly held by the probe-guard (enabling`,
        "it would mark a working app unhealthy).",
        "",
        "## Required change",
        `In repo \`${repoLine}\`: add a handler that serves \`${path}\` returning 2xx (mirror the app's`,
        "existing health response). Keep any existing health path working — do not remove or relocate it.",
        "",
        "## Acceptance check",
        `\`GET ${target}\` returns 2xx. Once it does, the next drift scan's probe-guard passes and the`,
        "infra health-check auto-enables; the change-manager item then auto-resolves (no manual close).",
        "",
        "## Scope guard",
        "App repo only. Open a PR; do NOT deploy. Do NOT use any infra/Coolify/secret tools.",
        "",
        "## Do-nots",
        "- Do NOT hand-resolve or wontfix the change-manager item.",
        "- Do NOT touch Coolify config or enable the health check manually.",
        "- Do NOT change unrelated routes.",
        "",
    ].join("\n");
}
/** Classify a probe-guard hold and, when app-conformance, attach a generated brief. */
export async function buildHandoff(proposal, probe, url, instance, deps = {}) {
    const lane = classifyLane(probe);
    if (lane !== "app-conformance")
        return { lane: "infra-config" };
    const path = String(proposal.planned_action?.args?.health_check_path ?? "/api/health");
    const { repo } = await resolveRepo(proposal.target.name, deps);
    const handoff_brief = generateHandoffBrief({
        repo,
        resourceName: proposal.target.name,
        instance,
        path,
        url: url ?? null,
        probeReason: probe?.reason ?? "non-2xx",
    });
    return { lane, handoff_brief };
}
//# sourceMappingURL=handoff-brief.js.map