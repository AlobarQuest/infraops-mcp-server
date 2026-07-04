// Parses the stdout of ~/.claude/bin/security-scan.sh into structured findings.
//
// The scanner emits one finding per line via:
//   printf '%-4s %-32s %s\n' "$sev" "$check" "$detail"
// e.g. "FAIL credfile.over_permissive          /Users/x/.env (mode 644) group/other-readable"
//
// SECURITY: the scanner already emits key NAMES only, never secret VALUES. This
// parser must never reconstruct or widen a secret value — it only ever splits the
// line the scanner already produced.

export type Severity = 'FAIL' | 'WARN' | 'PASS';

export interface Finding {
  severity: Severity;
  /** stable check key, e.g. "credfile.over_permissive" */
  check: string;
  /** full detail text the scanner emitted (key-names only, no secret values) */
  detail: string;
  /** the path/resource the finding is about — used for autofix-allowlist match + fingerprinting */
  target: string;
}

const LINE = /^(FAIL|WARN|PASS)\s+(\S+)\s+(.*)$/;

/**
 * Extract the stable target (path/resource) from a finding's detail.
 * Path-bearing checks emit either `<path> (mode NNN) ...` or `<file>: <rest>`.
 * Everything else (listeners, os toggles, supply) uses the whole detail as the
 * discriminator — stable enough for fingerprinting.
 */
export function extractTarget(detail: string): string {
  // "<path> (mode 644) ..." — robust even when the path contains spaces.
  const modeIdx = detail.indexOf(' (mode ');
  if (modeIdx > 0) return detail.slice(0, modeIdx).trim();

  // "<file>: <rest>" — shell/mcp/tiktok forms. Require the left side to look like a path/file.
  const colon = detail.match(/^((?:\/|~\/)?[^:]*?\.(?:env|json|pem|key|plist)|(?:\/|~\/)[^:]+):\s/);
  if (colon) return colon[1].trim();

  // leading absolute/home path up to the first " (" (e.g. backup keys without "(mode ")
  const lead = detail.match(/^((?:\/|~\/)\S.*?)(?:\s\(|$)/);
  if (lead) return lead[1].trim();

  // listeners / os / supply: the whole detail is the discriminator
  return detail.trim();
}

/** Parse scanner stdout into findings. Non-matching lines (headers, summary) are skipped. */
export function parseScan(stdout: string): Finding[] {
  const findings: Finding[] = [];
  for (const raw of stdout.split('\n')) {
    const m = raw.match(LINE);
    if (!m) continue;
    const detail = m[3].trim();
    findings.push({
      severity: m[1] as Severity,
      check: m[2],
      detail,
      target: extractTarget(detail),
    });
  }
  return findings;
}
