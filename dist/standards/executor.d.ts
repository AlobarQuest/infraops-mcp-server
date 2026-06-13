import type { CoolifyInstance } from "../services/coolify-client.js";
import type { Proposal } from "./check-engine.js";
/**
 * A whitelisted safe remediation: how to re-read the live resource (for the
 * idempotency check) and how to apply the change. This map is the safety
 * keystone — only tools present here can ever be auto-applied.
 */
interface SafeTool {
    fetch: (args: Record<string, unknown>, instance: CoolifyInstance) => Promise<Record<string, unknown>>;
    apply: (args: Record<string, unknown>, instance: CoolifyInstance) => Promise<unknown>;
}
export declare const SAFE_TOOLS: Record<string, SafeTool>;
/** True if applying `args` would actually change the resource (uuid is the selector, not a field). */
export declare function wouldChange(current: Record<string, unknown>, args: Record<string, unknown>): boolean;
/** The four-gate check: only safe, high-confidence, whitelisted remediations may auto-apply. */
export declare function isAutoApplicable(p: Proposal): boolean;
export interface ApplyResult {
    proposal_id: string;
    target: Proposal["target"];
    tool: string;
    args: Record<string, unknown>;
    status: "applied" | "skipped" | "failed";
    detail: string;
}
/** Read MAX_AUTO_APPLIES from env (positive integer); default 20. The runaway guard ceiling. */
export declare function maxAutoApplies(): number;
/**
 * Apply one safe remediation. Re-reads live state first: skips if already
 * conformant (idempotent), previews under dryRun, applies otherwise. Never
 * throws — a client failure is captured as status "failed" so the batch
 * continues. Defense in depth: a non-auto-applicable proposal is refused
 * without any network call.
 */
export declare function applyAction(p: Proposal, instance: CoolifyInstance, opts?: {
    dryRun?: boolean;
}): Promise<ApplyResult>;
export interface VerifyResult {
    ok: boolean;
    reason: string;
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
export declare function verifySafe(p: Proposal, instance: CoolifyInstance): Promise<VerifyResult>;
export {};
//# sourceMappingURL=executor.d.ts.map