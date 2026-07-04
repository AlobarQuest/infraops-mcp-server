import type { Proposal } from './check-engine.js';
import type { ProbeResult } from './executor.js';
import type { Lane } from './remediation-registry.js';
import type { AppResolution } from '../services/appbrain-client.js';
/** Parse a bare host from a URL. http/https only; reject userinfo; return the lowercased hostname
 *  (no port); null on any invalid/unsafe input. Coolify app fields are not a trust boundary. */
export declare function hostFromUrl(url: string | null | undefined): string | null;
/** Injected app-brain resolver seam. Production wires the real resolveApp; tests inject a fake.
 *  Returns the matched env (repo/branch may be null) or null on no-match. */
export interface HandoffDeps {
    appBrainResolve?: (args: {
        coolifyAppUuid: string;
        fqdn: string | null;
    }) => Promise<AppResolution | null>;
}
/**
 * App-conformance iff the probe got a concrete client-error status that signals a path/route
 * problem the app must fix in code: 4xx excluding auth (401/403). Everything else — timeout
 * (null), 3xx redirect / SSO, 401/403 auth, 5xx server error — is infra/retry, NOT app-conformance.
 */
export declare function classifyLane(probe: ProbeResult | undefined): Lane;
/** The structured, machine-readable handoff package — single source of truth (see contract). */
export interface HandoffPackage {
    repo: string;
    target_branch: string;
    rule: string;
    verified_gap: string;
    required_change: string;
    acceptance_check: string;
    scope_guard: string;
    do_nots: string[];
}
export declare function buildHandoffPackage(args: {
    repo: string | null;
    targetBranch: string | null;
    rule: string;
    path: string;
    url: string | null;
    probeReason: string;
}): HandoffPackage;
/** Render the human copy/paste markdown FROM the structured package (so the two cannot drift). */
export declare function renderHandoffBrief(pkg: HandoffPackage): string;
/** Classify a probe-guard hold and, when app-conformance, build the structured package + rendered brief. */
export declare function buildHandoff(proposal: Proposal, probe: ProbeResult | undefined, url: string | undefined, instance: string, deps?: HandoffDeps): Promise<{
    lane: Lane;
    handoff?: HandoffPackage;
    handoff_brief?: string;
}>;
//# sourceMappingURL=handoff-brief.d.ts.map