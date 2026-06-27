import { coolifyGet } from "../services/coolify-client.js";
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
    probe?: ProbeResult;
    url?: string;
}
/** Result of an HTTP health probe: the status code (null on network error/timeout) + a human reason. */
export interface ProbeResult {
    status: number | null;
    reason: string;
}
/** Injectable HTTP probe so verifySafe is testable without real network. */
export type HealthProbe = (url: string, timeoutMs: number) => Promise<ProbeResult>;
/**
 * Default probe: GET with a hard timeout. Redirects are NOT followed — an SSO/forward-auth
 * 302 must read as "not a 2xx health response" (→ escalate), never silently resolve to a
 * login page that returns 200. A network error/timeout yields status=null.
 */
export declare function probeHealthPath(url: string, timeoutMs: number): Promise<ProbeResult>;
/**
 * Build the public health-probe URL: the first FQDN (https-normalized, trailing slash
 * stripped) + the path. Returns null when there is no FQDN to probe.
 */
export declare function buildHealthProbeUrl(fqdn: unknown, path: string): string | null;
/** Resolve the port to probe internally: the app's health_check_port, else the first exposed port. "" if neither. */
export declare function internalProbePort(app: Record<string, unknown>): string;
/**
 * Inputs for a container-internal health probe: the live container is resolved by Coolify
 * label, so only the instance + app uuid + port + path are needed (never a container name —
 * names are ephemeral under rolling deploys).
 */
export interface InternalProbeArgs {
    instance: CoolifyInstance;
    uuid: string;
    port: string;
    path: string;
}
/** Injectable container-internal probe so verifySafe is testable without real SSH/orb. */
export type InternalHealthProbe = (args: InternalProbeArgs, timeoutMs: number) => Promise<ProbeResult>;
/**
 * Pick the primary (web) container among the containers that match an app's `coolify.applicationId`
 * label. A compose app's worker/scheduler sidecars carry the same label, and `docker ps` ordering
 * is not guaranteed (observed live: the worker is listed first), so prefer a name that isn't a known
 * sidecar; fall back to the first match. "" when there are no matches.
 */
export declare function pickAppContainer(names: string[]): string;
/**
 * Default container-internal probe — the fallback for internal-only apps whose public FQDN is
 * unreachable (e.g. dev's Watchtower at watchtower.local). Resolves the app's CURRENT container
 * by its Coolify label (`coolify.applicationId=<uuid>`) — never a cached/assumed name, since
 * rolling deploys rename containers each run — then `docker exec`s a curl against
 * `http://127.0.0.1:<port>/<path>`. Routes through the VPS dispatch: dev → orb (OrbStack VM),
 * prod → ssh (Hetzner). A 2xx means the app serves its health path internally → safe to enable.
 * No container, no curl, or a connection failure (curl http_code "000") yields status=null so the
 * caller escalates rather than guessing.
 */
export declare function probeHealthPathInternal(args: InternalProbeArgs, timeoutMs: number): Promise<ProbeResult>;
/**
 * Pre-apply gate for safe remediations that could misfire. Currently only the health-check
 * enable: enabling a Coolify health check on an app that does not actually serve the health
 * path would mark a working app unhealthy. We verify by HTTP-probing the app's PUBLIC health
 * path — the exact path the remediation will set (so probe and config can never disagree).
 * A 2xx means the app serves it → safe to auto-enable. Anything else (redirect/SSO, 4xx/5xx,
 * timeout, or no FQDN) reroutes the proposal to escalation with a reason, where a human
 * confirms the path and enables manually.
 *
 * This replaces the old running:healthy gate, which was a chicken-and-egg trap: an app can't
 * report running:healthy until it already has a passing health check, so no app missing one
 * could ever auto-remediate.
 *
 * Keyed on the remediation_key (the proposal id prefix), so it gates *only* enable_healthcheck.
 * Fails closed: an unreadable app, a missing FQDN, or a non-2xx probe escalates rather than applies.
 * `deps` is injectable for tests; production uses the real client + probe.
 */
export declare function verifySafe(p: Proposal, instance: CoolifyInstance, deps?: {
    get?: typeof coolifyGet;
    probe?: HealthProbe;
    internalProbe?: InternalHealthProbe;
}): Promise<VerifyResult>;
export {};
//# sourceMappingURL=executor.d.ts.map