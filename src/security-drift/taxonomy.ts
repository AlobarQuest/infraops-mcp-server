// Classification taxonomy — the authoritative source is
// ~/docs/security-audit/security-drift-taxonomy.md (post-4-model-debate, 2026-06-15).
// This encodes that taxonomy as code. Deny-by-default: any check key not explicitly
// mapped, and anything that fails a guard, is URGENT/manual — never auto-applied.

import type { Finding } from "./scan-parser.js";

export type Tier = "AUTO_FIX" | "URGENT" | "NORMAL";

/** A remediation is EITHER a list of exact commands to run verbatim, OR human steps. */
export type Remediation = { exec: string[][] } | { manual: string[] };

export interface Classification {
  tier: Tier;
  kind: "remediation" | "question";
  risk: "safe" | "caution" | "destructive";
  remediation: Remediation;
  title: string;
}

export interface ClassifyOptions {
  /** Explicit path-allowlist for chmod auto-fix. Deny-by-default: empty ⇒ nothing auto-fixes. */
  autoFixAllowlist: string[];
  /** Extra false-positive path/detail substrings to drop, beyond the built-ins. */
  fpExtra?: string[];
}

// Built-in false-positive matchers (protect the approval gate from alert-fatigue).
const FP_PATH_PATTERNS: RegExp[] = [
  /\.env\.(example|template|sample|dist)$/i,
  /(^|\/)(test|tests|__tests__|fixtures|testdata)(\/|$)/i,
  /(^|\/)(fullchain|chain|cert|cacert|ca-bundle|ca|public)\.pem$/i,
  /\.pub$/i,
];

/** True when a finding should be dropped as a known false positive. */
export function isFalsePositive(f: Finding, opts: ClassifyOptions): boolean {
  if (FP_PATH_PATTERNS.some((re) => re.test(f.target))) return true;
  if (opts.fpExtra?.some((s) => f.target.includes(s) || f.detail.includes(s))) return true;
  return false;
}

// Intent groups for URGENT (so equivalents are caught even if a new key appears).
const URGENT_KEYS = new Set<string>([
  "shell.plaintext_secret",
  "mcp.inlined_secret",
  "settings.write_wildcard",
  "settings.infraops_wildcard",
  "settings.update_wildcard",
  "settings.skip_dangerous_prompt",
  "settings.checks",
  "listener.lan_exposed",
  "hooks.gate_missing",
  "hooks.gate_unregistered",
  "backupkey.world_writable",
  "tiktok.plaintext_password",
  // control-plane integrity (the fixer protecting itself):
  "auditlog.tampered",
  "selfcheck.state_perms",
  "selfcheck.runner_integrity",
  // persistence classes the fast-follow watcher will feed in:
  "authorized_keys.changed",
  "launchagent.new",
  "shell_profile.changed",
  "mcp.server_added",
  // control-plane tamper-evidence (~/.claude git repo):
  "controlplane.drift",
  "controlplane.unmanaged",
]);

// Findings surfaced in the scan log but intentionally NOT escalated (expected churn).
const IGNORE_KEYS = new Set<string>(["controlplane.local_churn"]);

// NORMAL checks with a deterministic, idempotent exec remediation.
// ONLY non-sudo, user-scope, idempotent commands belong here — the 4am executor runs
// unattended as the user, so anything needing sudo (gatekeeper, critical-updates) or
// environment-specific judgement (supply re-pins) stays manual (deny-by-default).
const NORMAL_EXEC: Record<string, string[][]> = {
  "os.screen_lock": [["defaults", "write", "com.apple.screensaver", "askForPassword", "-int", "1"]],
};

const SHORT_TITLES: Record<string, string> = {
  "credfile.over_permissive": "Over-permissive credential file",
  "credfile.private_key": "Group/other-readable private key",
  "shell.plaintext_secret": "Inline plaintext secret in shell config",
  "mcp.inlined_secret": "Inline secret in MCP config",
  "listener.lan_exposed": "Service port exposed on 0.0.0.0",
  "backupkey.world_writable": "World-writable backup key",
  "tiktok.plaintext_password": "Plaintext DB password in plist",
  "controlplane.drift": "Control-plane file changed without review",
  "controlplane.unmanaged": "Control plane not under version control",
};

function titleFor(f: Finding): string {
  return SHORT_TITLES[f.check] ?? f.check;
}

/**
 * Classify a single finding. Returns null when it is a known false positive (dropped).
 * Only FAIL/WARN findings should be passed in; PASS findings are not drift.
 */
export function classify(f: Finding, opts: ClassifyOptions): Classification | null {
  if (isFalsePositive(f, opts)) return null;
  if (IGNORE_KEYS.has(f.check)) return null;

  const title = titleFor(f);

  // AUTO-FIX candidates: cred-file perms, ONLY when path is explicitly allowlisted.
  // The runtime guards (symlink/hardlink/owner/parent) run in autofix.ts; a guard
  // failure there re-tiers to URGENT (AUTO-FIX-BLOCKED).
  if (f.check === "credfile.over_permissive" || f.check === "credfile.private_key") {
    if (opts.autoFixAllowlist.includes(f.target)) {
      return { tier: "AUTO_FIX", kind: "remediation", risk: "safe", remediation: { exec: [["chmod", "600", f.target]] }, title };
    }
    return {
      tier: "URGENT",
      kind: "question",
      risk: "caution",
      remediation: { manual: [`Review and tighten permissions on ${f.target} (not on the chmod auto-fix allowlist).`] },
      title,
    };
  }

  if (URGENT_KEYS.has(f.check)) {
    return {
      tier: "URGENT",
      kind: "question",
      risk: "caution",
      remediation: { manual: [`Remediate ${f.check}: ${f.detail}`] },
      title,
    };
  }

  if (f.check in NORMAL_EXEC) {
    return { tier: "NORMAL", kind: "remediation", risk: "safe", remediation: { exec: NORMAL_EXEC[f.check] }, title };
  }

  if (f.check.startsWith("os.") || f.check.startsWith("supply.")) {
    return {
      tier: "NORMAL",
      kind: "question",
      risk: "safe",
      remediation: { manual: [`Review and remediate ${f.check}: ${f.detail}`] },
      title,
    };
  }

  // Deny-by-default: anything unknown is URGENT triage, never auto.
  return {
    tier: "URGENT",
    kind: "question",
    risk: "caution",
    remediation: { manual: [`Unknown security check '${f.check}' — triage: ${f.detail}`] },
    title,
  };
}
