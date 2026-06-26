import type { Proposal } from "./check-engine.js";
import type { ProbeResult } from "./executor.js";
import type { Lane } from "./remediation-registry.js";

/** Parse a bare host from a URL. http/https only; reject userinfo; return the lowercased hostname
 *  (no port); null on any invalid/unsafe input. Coolify app fields are not a trust boundary. */
export function hostFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  return host === "" ? null : host;
}

/** Optional app-brain confirmation seam (not wired in v1 production → structural parse decides). */
export interface HandoffDeps {
  appBrainLookup?: (repo: string) => Promise<boolean>;
}

/**
 * App-conformance iff the probe got a concrete client-error status that signals a path/route
 * problem the app must fix in code: 4xx excluding auth (401/403). Everything else — timeout
 * (null), 3xx redirect / SSO, 401/403 auth, 5xx server error — is infra/retry, NOT app-conformance.
 */
export function classifyLane(probe: ProbeResult | undefined): Lane {
  const s = probe?.status;
  if (s !== undefined && s !== null && s >= 400 && s < 500 && s !== 401 && s !== 403) {
    return "app-conformance";
  }
  return "infra-config";
}

/** Derive the target repo from resource_name (`<owner>/<repo>:<branch>` → `<repo>`), optionally
 * cross-checked with app-brain. Returns `{repo:null}` when it cannot be resolved confidently. */
export async function resolveRepo(
  resourceName: string,
  deps: HandoffDeps = {},
): Promise<{ repo: string | null; confirmed: boolean }> {
  const noBranch = String(resourceName ?? "").trim().split(":")[0];
  const candidate = noBranch.includes("/") ? (noBranch.split("/").pop() ?? "").trim() : "";
  if (!candidate) return { repo: null, confirmed: false };
  if (deps.appBrainLookup) {
    let confirmed = false;
    try { confirmed = await deps.appBrainLookup(candidate); } catch { confirmed = false; }
    return confirmed ? { repo: candidate, confirmed: true } : { repo: null, confirmed: false };
  }
  return { repo: candidate, confirmed: false };
}

/** The structured, machine-readable handoff package — single source of truth (see contract). */
export interface HandoffPackage {
  repo: string;            // resolved repo or "UNCONFIRMED"
  target_branch: string;
  rule: string;            // remediation/standard key
  verified_gap: string;
  required_change: string;
  acceptance_check: string;
  scope_guard: string;
  do_nots: string[];
}

/** Parse the branch from resource_name (`<owner>/<repo>:<branch>`); default "main" when absent. */
export function parseTargetBranch(resourceName: string): string {
  const seg = String(resourceName ?? "").split(":")[1];
  const branch = (seg ?? "").trim();
  return branch || "main";
}

export function buildHandoffPackage(args: {
  repo: string | null; targetBranch: string; rule: string; path: string; url: string | null; probeReason: string;
}): HandoffPackage {
  const { repo, targetBranch, rule, path, url, probeReason } = args;
  const target = url ?? `https://<fqdn>${path}`;
  return {
    repo: repo ?? "UNCONFIRMED",
    target_branch: targetBranch,
    rule,
    verified_gap: `Probe ${target} → ${probeReason}; the app does not serve the standard health path ${path}. The infra health-check enable was correctly held by the probe-guard.`,
    required_change: `In repo ${repo ?? "UNCONFIRMED — confirm before dispatch"} (branch ${targetBranch}): add a handler serving ${path} returning 2xx (mirror the app's existing health response). Keep any existing health path working.`,
    acceptance_check: `GET ${target} returns 2xx. Once it does, the next drift scan's probe-guard passes and the infra health-check auto-enables; the change-manager item then auto-resolves.`,
    scope_guard: "App repo only. Open a PR; do NOT deploy. Do NOT use any infra/Coolify/secret tools.",
    do_nots: [
      "Do NOT hand-resolve or wontfix the change-manager item.",
      "Do NOT touch Coolify config or enable the health check manually.",
      "Do NOT change unrelated routes.",
    ],
  };
}

/** Render the human copy/paste markdown FROM the structured package (so the two cannot drift). */
export function renderHandoffBrief(pkg: HandoffPackage): string {
  return [
    `# Handoff brief: ${pkg.repo}${pkg.repo === "UNCONFIRMED" ? " — confirm before dispatch" : ""}`,
    "",
    "**Lane:** app-conformance — the fix is an application code change, not infra config.",
    "",
    "## Source",
    `change-manager drift item, rule \`${pkg.rule}\` (target branch \`${pkg.target_branch}\`).`,
    "",
    "## Verified gap",
    pkg.verified_gap,
    "",
    "## Required change",
    pkg.required_change,
    "",
    "## Acceptance check",
    pkg.acceptance_check,
    "",
    "## Scope guard",
    pkg.scope_guard,
    "",
    "## Do-nots",
    ...pkg.do_nots.map((d) => `- ${d}`),
    "",
  ].join("\n");
}

/** Classify a probe-guard hold and, when app-conformance, build the structured package + rendered brief. */
export async function buildHandoff(
  proposal: Proposal,
  probe: ProbeResult | undefined,
  url: string | undefined,
  instance: string,
  deps: HandoffDeps = {},
): Promise<{ lane: Lane; handoff?: HandoffPackage; handoff_brief?: string }> {
  const lane = classifyLane(probe);
  if (lane !== "app-conformance") return { lane: "infra-config" };
  const path = String(
    (proposal.planned_action?.args as Record<string, unknown> | undefined)?.health_check_path ?? "/api/health",
  );
  const { repo } = await resolveRepo(proposal.target.name, deps);
  const rule = proposal.id.split(":")[0];
  const handoff = buildHandoffPackage({
    repo, targetBranch: parseTargetBranch(proposal.target.name), rule,
    path, url: url ?? null, probeReason: probe?.reason ?? "non-2xx",
  });
  return { lane, handoff, handoff_brief: renderHandoffBrief(handoff) };
}
