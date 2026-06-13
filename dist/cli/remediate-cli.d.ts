#!/usr/bin/env node
/**
 * Headless remediation pass. Reads the morning drift report for context, re-audits
 * live, auto-applies safe remediations, asks Sonnet to plan the rest, and writes
 * <date>.remediation.json + <date>.remediation.md. Chained after audit-cli in
 * scripts/drift-audit.sh.
 *
 *   node dist/cli/remediate-cli.js --instance prod,dev --report-dir /reports --now <iso>
 *   node dist/cli/remediate-cli.js --instance prod --report-dir /reports --dry-run
 *
 * Exit code: 0 if at least one instance was audited cleanly; 1 if every instance
 * hard-failed (keeps the heartbeat semantics identical to audit-cli).
 */
export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
//# sourceMappingURL=remediate-cli.d.ts.map