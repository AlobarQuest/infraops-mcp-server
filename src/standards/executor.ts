import { coolifyGet, coolifyPatch } from "../services/coolify-client.js";
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

export const SAFE_TOOLS: Record<string, SafeTool> = {
  coolify_update_application: {
    fetch: (args, instance) =>
      coolifyGet<Record<string, unknown>>(`/applications/${args.uuid}`, undefined, instance),
    apply: (args, instance) => {
      const { uuid, ...fields } = args;
      return coolifyPatch(`/applications/${uuid}`, fields, instance);
    },
  },
};

/** True if applying `args` would actually change the resource (uuid is the selector, not a field). */
export function wouldChange(current: Record<string, unknown>, args: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(args)) {
    if (k === "uuid") continue;
    if (current[k] !== v) return true;
  }
  return false;
}

/** The four-gate check: only safe, high-confidence, whitelisted remediations may auto-apply. */
export function isAutoApplicable(p: Proposal): boolean {
  return (
    p.kind === "remediation" &&
    p.risk === "safe" &&
    p.confidence === "high" &&
    p.planned_action !== null &&
    Object.prototype.hasOwnProperty.call(SAFE_TOOLS, p.planned_action.tool)
  );
}
