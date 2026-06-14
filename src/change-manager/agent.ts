import Anthropic from "@anthropic-ai/sdk";
import { coolifyGet, type CoolifyInstance } from "../services/coolify-client.js";
import type { ApprovedItem } from "./api-client.js";
import { TOOLS, runTool, httpsConformant, revertRollback, type ToolCtx } from "./tools.js";

export interface ChangeOutcome {
  outcome: "done" | "blocked" | "failed" | "skipped_conformant";
  detail: string;
  rollback: Record<string, unknown>;
  tool_calls: { calls: Array<{ name: string; input: unknown; result: string }> };
}

type ToolCalls = ChangeOutcome["tool_calls"]["calls"];

export interface AgentDeps { client?: Anthropic; maxSteps?: number; }

/** HTTPS-enable remediation rule keys (the one change-type we live pre/post-verify). */
const HTTPS_RULE_KEYS = new Set(["coolify.force_https"]);

/** Precise match: is this an HTTPS-enable remediation? */
function isHttpsRemediation(item: ApprovedItem): boolean {
  return HTTPS_RULE_KEYS.has(item.rule_key);
}

/** Pre-validate live: an already-conformant HTTPS item needs no change → skip it (no writes). */
async function preValidateConformant(item: ApprovedItem, ctx: ToolCtx): Promise<boolean> {
  if (!isHttpsRemediation(item)) return false;
  try {
    const app = await coolifyGet<Record<string, unknown>>(`/applications/${item.resource_uuid}`, undefined, ctx.instance);
    return !!app && httpsConformant(app);
  } catch {
    return false; // can't confirm → let the agent try
  }
}

/**
 * Post-verify a 'done': re-fetch live and confirm the change actually took. If not,
 * revert via the captured rollback and return a 'failed' outcome to substitute.
 * Returns null to keep 'done'. A post-verify *read* error is inconclusive → keep 'done'
 * (don't revert a possibly-good change on a transient read failure).
 *
 * SCOPE: for HTTPS this confirms the domain *config* is all-https — the same thing the
 * drift standard (#571 `fqdn not_starts_with http://`) asserts. It does NOT confirm the
 * async redeploy/cert regeneration actually succeeded: `set_application_domains` sets the
 * config field synchronously, so this check passes even if `redeploy_application` errored.
 * Deterministic deploy-success / live-cert verification is BACKLOG.md #5.
 */
async function postVerifyOrRevert(item: ApprovedItem, ctx: ToolCtx, calls: ToolCalls): Promise<ChangeOutcome | null> {
  const checksDomains = ctx.rollback.domains !== undefined;
  const checksHealth = ctx.rollback.health_check_enabled !== undefined;
  if (!checksDomains && !checksHealth) return null;
  try {
    const app = await coolifyGet<Record<string, unknown>>(`/applications/${item.resource_uuid}`, undefined, ctx.instance);
    if (checksDomains && (!app || !httpsConformant(app))) {
      await revertRollback(item.resource_uuid, ctx.rollback, ctx.instance).catch(() => {});
      return { outcome: "failed", detail: "post-verify failed: domains not https after change; reverted via rollback", rollback: ctx.rollback, tool_calls: { calls } };
    }
    if (checksHealth && (!app || app.health_check_enabled !== true)) {
      await revertRollback(item.resource_uuid, ctx.rollback, ctx.instance).catch(() => {});
      return { outcome: "failed", detail: "post-verify failed: health check not enabled after change; reverted via rollback", rollback: ctx.rollback, tool_calls: { calls } };
    }
  } catch {
    return null;
  }
  return null;
}

function buildSystem(): string {
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

function buildUserMessage(item: ApprovedItem): string {
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
export async function runChangeAgent(item: ApprovedItem, deps: AgentDeps = {}): Promise<ChangeOutcome> {
  const client = deps.client ?? new Anthropic();
  const maxSteps = deps.maxSteps ?? 12;
  const ctx: ToolCtx = { instance: item.instance as CoolifyInstance, rollback: {} };
  const calls: ToolCalls = [];

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserMessage(item) }];

  try {
    // Pre-validate live: already-conformant → skip without running the agent or writing.
    if (await preValidateConformant(item, ctx)) {
      return { outcome: "skipped_conformant", detail: "already conformant live; no change needed", rollback: ctx.rollback, tool_calls: { calls } };
    }

    for (let step = 0; step < maxSteps; step++) {
      const res: Anthropic.Message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: buildSystem(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: TOOLS as any,
        messages,
      });
      messages.push({ role: "assistant", content: res.content });

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) {
        // model ended without a control tool → treat as failed (no completion signal)
        return { outcome: "failed", detail: "agent ended without report_done/blocked", rollback: ctx.rollback, tool_calls: { calls } };
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (tu.name === "report_done") {
          const summary = String((tu.input as { summary?: string }).summary ?? "done");
          calls.push({ name: tu.name, input: tu.input, result: summary });
          const reverted = await postVerifyOrRevert(item, ctx, calls);
          return reverted ?? { outcome: "done", detail: summary, rollback: ctx.rollback, tool_calls: { calls } };
        }
        if (tu.name === "report_blocked") {
          const reason = String((tu.input as { reason?: string }).reason ?? "blocked");
          calls.push({ name: tu.name, input: tu.input, result: reason });
          return { outcome: "blocked", detail: reason, rollback: ctx.rollback, tool_calls: { calls } };
        }
        // a write/read tool
        let result: string;
        let isError = false;
        try {
          result = await runTool(tu.name, tu.input as Record<string, unknown>, ctx);
        } catch (e) {
          result = e instanceof Error ? e.message : String(e);
          isError = true;
        }
        calls.push({ name: tu.name, input: tu.input, result });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result, is_error: isError });
      }
      messages.push({ role: "user", content: toolResults });
    }
    return { outcome: "failed", detail: "exceeded max steps", rollback: ctx.rollback, tool_calls: { calls } };
  } catch (e) {
    return { outcome: "failed", detail: e instanceof Error ? e.message : String(e), rollback: ctx.rollback, tool_calls: { calls } };
  }
}
