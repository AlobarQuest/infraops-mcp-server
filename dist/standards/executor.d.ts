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
export {};
//# sourceMappingURL=executor.d.ts.map