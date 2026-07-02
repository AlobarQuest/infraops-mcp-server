import Anthropic from "@anthropic-ai/sdk";
import { coolifyGet } from "../services/coolify-client.js";
import { TOOLS, runTool, httpsConformant, revertRollback, deploymentSucceeded, httpsLive, firstDomain, } from "./tools.js";
const defaultPostVerifyDeps = {
    deploymentSucceeded, httpsLive, pollAttempts: 6, pollDelayMs: 10_000,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
/** HTTPS-enable remediation rule keys (the one change-type we live pre/post-verify). */
const HTTPS_RULE_KEYS = new Set(["coolify.force_https"]);
/** Precise match: is this an HTTPS-enable remediation? */
function isHttpsRemediation(item) {
    return HTTPS_RULE_KEYS.has(item.rule_key);
}
/** Pre-validate live: an already-conformant HTTPS item needs no change → skip it (no writes). */
async function preValidateConformant(item, ctx) {
    if (!isHttpsRemediation(item))
        return false;
    try {
        const app = await coolifyGet(`/applications/${item.resource_uuid}`, undefined, ctx.instance);
        return !!app && httpsConformant(app);
    }
    catch {
        return false; // can't confirm → let the agent try
    }
}
/**
 * Post-verify a 'done': re-fetch live and confirm the change actually took. If not,
 * revert via the captured rollback and return a 'failed' outcome to substitute.
 * Returns null to keep 'done'. A post-verify *read* error is inconclusive → keep 'done'
 * (don't revert a possibly-good change on a transient read failure).
 *
 * SCOPE (BACKLOG #5 — CLOSED): the HTTPS path now verifies three layers beyond the
 * config field: (B) a `redeploy_application` call ran without error, (A) the deployment
 * it triggered reached success (bounded poll), and the live TLS cert validates. A failed
 * or never-run redeploy, a failed deployment, or an invalid cert now yields `failed` +
 * revert instead of `done`. A *read*-side inconclusive (deployment status unknown/pending
 * on a clean redeploy, or a transient fetch error) conservatively keeps `done` — we never
 * revert a possibly-good change on a read failure.
 */
export async function postVerifyOrRevert(item, ctx, calls, deps = defaultPostVerifyDeps) {
    const checksDomains = ctx.rollback.domains !== undefined;
    const checksHealth = ctx.rollback.health_check_enabled !== undefined;
    if (!checksDomains && !checksHealth)
        return null;
    const fail = async (detail) => {
        await revertRollback(item.resource_uuid, ctx.rollback, ctx.instance).catch(() => { });
        return { outcome: "failed", detail: `post-verify failed: ${detail}; reverted via rollback`, rollback: ctx.rollback, tool_calls: { calls } };
    };
    try {
        const app = await coolifyGet(`/applications/${item.resource_uuid}`, undefined, ctx.instance);
        if (checksDomains) {
            // 1. config gate (unchanged): the domain field must actually be https now.
            if (!app || !httpsConformant(app))
                return await fail("domains not https after change");
            // 2. (B) deterministic: a redeploy must have run without error — the async deploy is
            //    what regenerates the Traefik route + Let's Encrypt cert. Never-run or errored
            //    (e.g. the booking-preview redeploy 404) is a half-applied state, not `done`.
            const redeploy = calls.find((c) => c.name === "redeploy_application");
            if (!redeploy || redeploy.is_error)
                return await fail("redeploy did not run or errored after domain change");
            // 3. (A) confirm the deployment reached success, bounded poll; then probe the live cert.
            const since = typeof ctx.domainsChangedAt === "number" ? ctx.domainsChangedAt : 0;
            let verdict = await deps.deploymentSucceeded(item.resource_uuid, since, ctx.instance);
            for (let i = 1; i < deps.pollAttempts && verdict === "pending"; i++) {
                await deps.sleep(deps.pollDelayMs);
                verdict = await deps.deploymentSucceeded(item.resource_uuid, since, ctx.instance);
            }
            if (verdict === "failed")
                return await fail("deploy failed after domain change");
            if (verdict === "success") {
                const domain = firstDomain(app);
                const live = domain ? await deps.httpsLive(domain) : true;
                if (!live)
                    return await fail("live cert not valid after deploy");
            }
            // verdict pending/unknown on a clean redeploy → inconclusive; keep `done` (conservative).
        }
        if (checksHealth && (!app || app.health_check_enabled !== true)) {
            return await fail("health check not enabled after change");
        }
    }
    catch {
        return null;
    }
    return null;
}
function buildSystem() {
    return [
        "You are an infrastructure change executor for a Coolify platform.",
        "Implement the approved remediation using ONLY the provided tools.",
        "Read the resource first if useful. For HTTPS: set the domains to https:// then redeploy.",
        "For health-checks: only enable if you can supply a path the app actually serves; otherwise report_blocked.",
        "When the change is complete, call report_done with a short summary.",
        "If you cannot complete it (missing prerequisite, no safe path, or needs a human decision), call report_blocked with the reason.",
        "Never invent tools. Make the minimal change.",
    ].join("\n");
}
function buildUserMessage(item) {
    return [
        `Resource: ${item.resource_type} '${item.resource_name}' (uuid ${item.resource_uuid}, instance ${item.instance})`,
        `Deviation: ${item.reasoning}`,
        `Guidance plan (advisory; tool names in it may be wrong — use only the provided tools): ${JSON.stringify(item.plan)}`,
    ].join("\n");
}
/**
 * Run one approved item through the Sonnet tool-use loop. Acts only via the curated tools.
 * Never throws: any failure resolves to outcome "failed". report_done → done; report_blocked → blocked;
 * exceeding maxSteps without a report → failed.
 */
export async function runChangeAgent(item, deps = {}) {
    const client = deps.client ?? new Anthropic();
    const maxSteps = deps.maxSteps ?? 12;
    const ctx = { instance: item.instance, rollback: {} };
    const calls = [];
    const messages = [{ role: "user", content: buildUserMessage(item) }];
    try {
        // Pre-validate live: already-conformant → skip without running the agent or writing.
        if (await preValidateConformant(item, ctx)) {
            return { outcome: "skipped_conformant", detail: "already conformant live; no change needed", rollback: ctx.rollback, tool_calls: { calls } };
        }
        for (let step = 0; step < maxSteps; step++) {
            const res = await client.messages.create({
                model: "claude-sonnet-4-6",
                max_tokens: 4096,
                system: buildSystem(),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tools: TOOLS,
                messages,
            });
            messages.push({ role: "assistant", content: res.content });
            const toolUses = res.content.filter((b) => b.type === "tool_use");
            if (toolUses.length === 0) {
                // model ended without a control tool → treat as failed (no completion signal)
                return { outcome: "failed", detail: "agent ended without report_done/blocked", rollback: ctx.rollback, tool_calls: { calls } };
            }
            const toolResults = [];
            for (const tu of toolUses) {
                if (tu.name === "report_done") {
                    const summary = String(tu.input.summary ?? "done");
                    calls.push({ name: tu.name, input: tu.input, result: summary });
                    const reverted = await postVerifyOrRevert(item, ctx, calls);
                    return reverted ?? { outcome: "done", detail: summary, rollback: ctx.rollback, tool_calls: { calls } };
                }
                if (tu.name === "report_blocked") {
                    const reason = String(tu.input.reason ?? "blocked");
                    calls.push({ name: tu.name, input: tu.input, result: reason });
                    return { outcome: "blocked", detail: reason, rollback: ctx.rollback, tool_calls: { calls } };
                }
                // a write/read tool
                let result;
                let isError = false;
                try {
                    result = await runTool(tu.name, tu.input, ctx);
                }
                catch (e) {
                    result = e instanceof Error ? e.message : String(e);
                    isError = true;
                }
                calls.push({ name: tu.name, input: tu.input, result, is_error: isError });
                toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result, is_error: isError });
            }
            messages.push({ role: "user", content: toolResults });
        }
        return { outcome: "failed", detail: "exceeded max steps", rollback: ctx.rollback, tool_calls: { calls } };
    }
    catch (e) {
        return { outcome: "failed", detail: e instanceof Error ? e.message : String(e), rollback: ctx.rollback, tool_calls: { calls } };
    }
}
//# sourceMappingURL=agent.js.map