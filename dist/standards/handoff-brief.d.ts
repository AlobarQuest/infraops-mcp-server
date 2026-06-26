import type { Proposal } from "./check-engine.js";
import type { ProbeResult } from "./executor.js";
import type { Lane } from "./remediation-registry.js";
/** Optional app-brain confirmation seam (not wired in v1 production → structural parse decides). */
export interface HandoffDeps {
    appBrainLookup?: (repo: string) => Promise<boolean>;
}
/**
 * App-conformance iff the probe got a concrete client-error status that signals a path/route
 * problem the app must fix in code: 4xx excluding auth (401/403). Everything else — timeout
 * (null), 3xx redirect / SSO, 401/403 auth, 5xx server error — is infra/retry, NOT app-conformance.
 */
export declare function classifyLane(probe: ProbeResult | undefined): Lane;
/** Derive the target repo from resource_name (`<owner>/<repo>:<branch>` → `<repo>`), optionally
 * cross-checked with app-brain. Returns `{repo:null}` when it cannot be resolved confidently. */
export declare function resolveRepo(resourceName: string, deps?: HandoffDeps): Promise<{
    repo: string | null;
    confirmed: boolean;
}>;
export declare function generateHandoffBrief(args: {
    repo: string | null;
    resourceName: string;
    instance: string;
    path: string;
    url: string | null;
    probeReason: string;
}): string;
/** Classify a probe-guard hold and, when app-conformance, attach a generated brief. */
export declare function buildHandoff(proposal: Proposal, probe: ProbeResult | undefined, url: string | undefined, instance: string, deps?: HandoffDeps): Promise<{
    lane: Lane;
    handoff_brief?: string;
}>;
//# sourceMappingURL=handoff-brief.d.ts.map