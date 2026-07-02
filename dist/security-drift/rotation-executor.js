// WS-0.7 rotation-plan runner — invoked by the 4am security executor for approved
// items whose (plan-hash-gated) remediation is `{ rotation: RotationPlanSpec }`.
//
// Enforced structurally, not by plan authoring:
//   - ORDER: store → deploy → verify → revoke-confirm. Each phase early-returns on
//     failure; the revoke branch is unreachable unless verify passed.
//   - The executor NEVER creates or revokes a credential at a provider. Create and
//     revoke are Devon console steps; the executor's "revoke" only CONFIRMS the old
//     value is dead (strict 401) and then retires the BWS copy + closes the exposure.
//   - Idempotent + resumable: rotation spans windows (deploy one night, Devon revokes
//     at the console, confirm the next). Every step checks current state first.
//   - NO secret value ever reaches a plan, an outcome detail, or a log line: values
//     move BWS/Keychain → memory → provider header / consumer setter. Every value
//     touched is registered for scrubbing and details are scrubbed before return.
//
// Accepted, documented tradeoff: `bws secret create/edit` and `security
// add-generic-password -w` take the value in argv (neither reads stdin), so the
// value is briefly visible in the local process list. Single-user machine; the
// alternatives (shell interpolation, files) are strictly worse.
import { execFileSync } from "node:child_process";
import { CLASS_POLICY } from "./cred-rotation.js";
/** Register-and-scrub: every secret value touched at runtime is redacted from details. */
class Scrubber {
    values = [];
    add(v) {
        if (v && v.length >= 8)
            this.values.push(v);
        return v;
    }
    clean(detail) {
        let out = detail;
        for (const v of this.values)
            out = out.split(v).join("[redacted]");
        return out;
    }
}
const DEAD_STATUS = 401; // strict: only an explicit auth rejection counts as revoked
export async function runRotationPlan(plan, deps) {
    const scrub = new Scrubber();
    const steps = [];
    const finish = (outcome, msg) => ({
        outcome,
        detail: scrub.clean([...steps, msg].join(" | ")),
    });
    try {
        // ── Structural guards (re-checked at run time, deny-by-default) ──────────────
        const policy = CLASS_POLICY[plan.credClass];
        if (!policy || !policy.executor)
            return finish("blocked", `class ${plan.credClass} is not executor-runnable`);
        if (!plan.consumersVerified)
            return finish("blocked", "consumer set not attested — refusing (fail-safe)");
        let newValue = null;
        let oldValue = null;
        let quarantineUuid = null;
        if (plan.keeperBwsUuid) {
            // ── STORE (reissue path): quarantine old value, then edit keeper in place ──
            if (!plan.staging || !plan.quarantineName || !plan.bwsProjectId) {
                return finish("blocked", "reissue plan missing staging/quarantine coordinates");
            }
            const staged = scrub.add(await deps.keychain.read(plan.staging.service, plan.staging.account));
            const quarantine = await deps.bws.findByName(plan.quarantineName, plan.bwsProjectId);
            if (quarantine) {
                quarantineUuid = quarantine.id;
                scrub.add(quarantine.value);
            }
            if (staged) {
                const keeperCurrent = scrub.add(await deps.bws.getValue(plan.keeperBwsUuid));
                if (keeperCurrent === null)
                    return finish("failed", `keeper secret ${plan.keeperBwsUuid} unreadable`);
                if (!quarantine) {
                    if (keeperCurrent === staged) {
                        // Keeper already carries the new value but the old value was never
                        // quarantined — we cannot confirm the old credential dead. Never guess.
                        return finish("blocked", "keeper already updated but no quarantined old value exists — confirm the provider revoke manually, then `security-drift-cli resolve-exposure`");
                    }
                    quarantineUuid = await deps.bws.create(plan.quarantineName, keeperCurrent, plan.bwsProjectId);
                    steps.push(`store: quarantined old value as ${plan.quarantineName}`);
                }
                if (keeperCurrent !== staged) {
                    await deps.bws.editValue(plan.keeperBwsUuid, staged);
                    steps.push(`store: keeper ${plan.keeperBwsUuid} updated in place (UUID stable)`);
                }
                else {
                    steps.push("store: keeper already carries the staged value");
                }
                newValue = staged;
            }
            else if (quarantine) {
                // Staged value already consumed on a prior night; keeper holds the new value.
                newValue = scrub.add(await deps.bws.getValue(plan.keeperBwsUuid));
                if (newValue === null)
                    return finish("failed", `keeper secret ${plan.keeperBwsUuid} unreadable`);
                steps.push("store: already completed on a prior window");
            }
            else {
                return finish("blocked", `new value not staged — mint it at the provider, then (real Terminal): security add-generic-password -U -s ${plan.staging.service} -a ${plan.staging.account} -T /usr/bin/security -w`);
            }
            oldValue = quarantine ? quarantine.value : scrub.add(quarantineUuid ? await deps.bws.getValue(quarantineUuid) : null);
            // ── DEPLOY: push the new value to every mapped consumer ────────────────────
            for (const consumer of plan.consumers) {
                const done = await deployConsumer(consumer, plan, newValue, deps, scrub);
                if (done)
                    steps.push(done);
            }
            // ── VERIFY: the new credential must authenticate at the provider ───────────
            const status = await deps.probe(plan.providerProbe, newValue, { email: plan.probeEmail, workspace: plan.probeWorkspace });
            if (status !== 200) {
                return finish("failed", `verify FAILED: new credential probe returned ${status} (expected 200) — check the staged value; nothing was revoked`);
            }
            steps.push(`verify: new credential authenticates (200)`);
        }
        else {
            // ── revoke-no-replacement path: nothing to store or deploy ─────────────────
            if (!plan.retireBwsUuids.length)
                return finish("blocked", "no old-value source (retireBwsUuids empty) — cannot confirm revoke");
            oldValue = scrub.add(await deps.bws.getValue(plan.retireBwsUuids[0]));
            if (oldValue === null)
                return finish("failed", `old-value secret ${plan.retireBwsUuids[0]} unreadable`);
        }
        // Keeper-verification discipline for GitHub-class rotations: the standing gh
        // keeper must authenticate BEFORE we treat a dead probe as a completed revoke
        // (protects against the wrong-token-revoked failure mode).
        if (plan.providerProbe === "github" && !(await deps.ghKeeperOk())) {
            return finish("failed", "gh keeper does NOT authenticate — investigate before any revoke bookkeeping");
        }
        // ── REVOKE-CONFIRM: probe the OLD value; retire only a provably dead credential ─
        if (oldValue === null)
            return finish("blocked", "old value unavailable — confirm the provider revoke manually, then resolve-exposure");
        const oldStatus = await deps.probe(plan.providerProbe, oldValue, { email: plan.probeEmail, workspace: plan.probeWorkspace });
        if (oldStatus === 200) {
            return finish("blocked", `old credential still LIVE at the provider — complete the console revoke, then re-approve. Steps: ${plan.manualSteps.join(" → ")}`);
        }
        if (oldStatus !== DEAD_STATUS) {
            return finish("blocked", `old-credential probe indeterminate (${oldStatus}) — refusing to retire; re-approve to retry`);
        }
        steps.push("revoke-confirm: old credential is dead at the provider (401)");
        if (plan.providerProbe === "github" && !(await deps.ghKeeperOk())) {
            return finish("failed", "old credential dead but gh keeper NO LONGER authenticates — the wrong token may have been revoked; investigate NOW");
        }
        for (const uuid of [...plan.retireBwsUuids, ...(quarantineUuid ? [quarantineUuid] : [])]) {
            await deps.bws.remove(uuid);
            steps.push(`retired BWS secret ${uuid}`);
        }
        if (plan.staging) {
            await deps.keychain.remove(plan.staging.service, plan.staging.account).catch(() => { });
        }
        await deps.state.completeRotation(plan.credId, plan.exposureIds, "revoke confirmed dead (401)");
        return finish("done", `rotation complete for ${plan.credId} — exposure(s) ${plan.exposureIds.join(", ") || "n/a"} closed`);
    }
    catch (e) {
        return finish("failed", `rotation error: ${e instanceof Error ? e.message : String(e)}`);
    }
}
async function deployConsumer(consumer, plan, newValue, deps, scrub) {
    switch (consumer.kind) {
        case "bws-secret": {
            if (consumer.uuid === plan.keeperBwsUuid)
                return null; // the keeper itself (store phase)
            if (!consumer.uuid)
                throw new Error("bws-secret consumer missing uuid");
            const current = scrub.add(await deps.bws.getValue(consumer.uuid));
            if (current === newValue)
                return null;
            await deps.bws.editValue(consumer.uuid, newValue);
            return `deploy: bws ${consumer.uuid} updated`;
        }
        case "keychain": {
            if (!consumer.service || !consumer.account)
                throw new Error("keychain consumer missing service/account");
            const current = scrub.add(await deps.keychain.read(consumer.service, consumer.account));
            if (current === newValue)
                return null;
            await deps.keychain.write(consumer.service, consumer.account, newValue);
            return `deploy: keychain ${consumer.service}/${consumer.account} updated`;
        }
        case "coolify-env": {
            if (!consumer.instance || !consumer.resource_type || !consumer.uuid || !consumer.key) {
                throw new Error("coolify-env consumer missing instance/resource_type/uuid/key");
            }
            const current = scrub.add(await deps.coolify.getEnv(consumer.instance, consumer.resource_type, consumer.uuid, consumer.key));
            if (current === newValue)
                return null;
            await deps.coolify.setEnv(consumer.instance, consumer.resource_type, consumer.uuid, consumer.key, newValue);
            if (consumer.redeploy) {
                await deps.coolify.redeploy(consumer.instance, consumer.uuid);
                return `deploy: coolify[${consumer.instance}] ${consumer.uuid}/${consumer.key} updated + redeploy triggered`;
            }
            return `deploy: coolify[${consumer.instance}] ${consumer.uuid}/${consumer.key} updated`;
        }
        case "gh-actions-secret": {
            if (!consumer.repo || !consumer.name)
                throw new Error("gh-actions-secret consumer missing repo/name");
            await deps.ghSecretSet(consumer.repo, consumer.name, newValue);
            return `deploy: gh secret ${consumer.repo}/${consumer.name} set`;
        }
        default:
            // Plan building already refuses unsupported kinds; hitting this means the plan
            // and executor disagree — fail loudly rather than skip silently.
            throw new Error(`unsupported consumer kind '${consumer.kind}'`);
    }
}
// ── Default (live) deps — child processes + fetch; injected fakes in tests ────────
function execCapture(cmd, opts = {}) {
    return execFileSync(cmd[0], cmd.slice(1), {
        shell: false,
        encoding: "utf8",
        timeout: opts.timeoutMs ?? 30_000,
        input: opts.input,
        env: opts.env,
        stdio: ["pipe", "pipe", "pipe"],
    });
}
// Bearer-auth probe endpoints (200 = live, 401 = dead). Bitbucket is handled
// separately (Basic auth email:token against a workspace-scoped endpoint).
const BEARER_PROBE_URLS = {
    github: "https://api.github.com/user",
    openrouter: "https://openrouter.ai/api/v1/auth/key",
    openai: "https://api.openai.com/v1/models",
};
export function defaultRotationDeps(io) {
    const envPath = (resourceType, uuid) => `/${resourceType === "service" ? "services" : "applications"}/${uuid}/envs`;
    // Every bws call runs with the rotation token in its own env, overriding whatever
    // broad token the ambient process carries.
    const bwsEnv = { ...process.env, BWS_ACCESS_TOKEN: io.bwsToken };
    const bwsExec = (cmd) => execCapture(cmd, { env: bwsEnv });
    return {
        bws: {
            async getValue(uuid) {
                try {
                    const out = bwsExec(["bws", "secret", "get", uuid, "--output", "json"]);
                    return JSON.parse(out).value ?? null;
                }
                catch {
                    return null;
                }
            },
            async findByName(name, projectId) {
                // scope to the project when known — an unscoped list fetches every secret's value
                const cmd = ["bws", "secret", "list", ...(projectId ? [projectId] : []), "--output", "json"];
                const all = JSON.parse(bwsExec(cmd));
                const hit = all.find((s) => s.key === name);
                return hit ? { id: hit.id, value: hit.value } : null;
            },
            async create(name, value, projectId) {
                const out = bwsExec(["bws", "secret", "create", name, value, projectId, "--output", "json"]);
                return JSON.parse(out).id;
            },
            async editValue(uuid, value) {
                bwsExec(["bws", "secret", "edit", uuid, "--value", value]);
            },
            async remove(uuid) {
                bwsExec(["bws", "secret", "delete", uuid]);
            },
        },
        keychain: {
            async read(service, account) {
                try {
                    return execCapture(["security", "find-generic-password", "-s", service, "-a", account, "-w"]).replace(/\n$/, "");
                }
                catch {
                    return null;
                }
            },
            async write(service, account, value) {
                execCapture(["security", "add-generic-password", "-U", "-s", service, "-a", account, "-T", "/usr/bin/security", "-w", value]);
            },
            async remove(service, account) {
                execCapture(["security", "delete-generic-password", "-s", service, "-a", account]);
            },
        },
        coolify: {
            async getEnv(instance, resourceType, uuid, key) {
                const envs = await io.coolifyGet(envPath(resourceType, uuid), instance);
                const hit = (envs ?? []).find((e) => e.key === key);
                return hit ? (hit.real_value ?? hit.value ?? null) : null;
            },
            async setEnv(instance, resourceType, uuid, key, value) {
                await io.coolifyPatch(envPath(resourceType, uuid), { key, value }, instance);
            },
            async redeploy(instance, uuid) {
                // canonical trigger form, same as change-manager/tools.ts
                await io.coolifyPost(`/deploy?uuid=${uuid}`, undefined, instance);
            },
        },
        async ghSecretSet(repo, name, value) {
            execCapture(["gh", "secret", "set", name, "-R", repo], { input: value });
        },
        async probe(kind, value, opts) {
            let url;
            let authHeader;
            if (kind === "bitbucket") {
                // Atlassian API token: Basic auth (email:token) against a workspace-scoped
                // endpoint the repo-scoped token can actually read. 200 = live, 401 = dead.
                if (!opts?.email || !opts?.workspace)
                    return 400; // misconfigured plan → not "dead"
                url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(opts.workspace)}?pagelen=1`;
                authHeader = "Basic " + Buffer.from(`${opts.email}:${value}`, "utf8").toString("base64");
            }
            else {
                url = BEARER_PROBE_URLS[kind];
                authHeader = `Bearer ${value}`;
            }
            const res = await fetch(url, {
                headers: {
                    Authorization: authHeader,
                    "User-Agent": "infraops-cred-rotation",
                    Accept: "application/json",
                    ...(kind === "github" ? { "X-GitHub-Api-Version": "2022-11-28" } : {}),
                },
                signal: AbortSignal.timeout(15_000),
            });
            // drain without reading the body into logs
            await res.arrayBuffer().catch(() => { });
            return res.status;
        },
        async ghKeeperOk() {
            try {
                execCapture(["gh", "api", "user", "-q", ".login"]);
                return true;
            }
            catch {
                return false;
            }
        },
        state: {
            async completeRotation(credId, exposureIds, detail) {
                const s = io.loadState();
                for (const id of exposureIds)
                    s.resolvedExposures[`${credId}:${id}`] = { ts: io.now, detail };
                s.lastRotated[credId] = io.now;
                io.saveState(s);
            },
        },
    };
}
//# sourceMappingURL=rotation-executor.js.map