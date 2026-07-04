import type { PlannedAction, Risk } from './check-engine.js';

/** Which lane owns the fix. Extension seam: future remediations can declare their lane here. */
export type Lane = 'infra-config' | 'app-conformance';

interface Remediation {
  tool: string;
  risk: Risk;
  /** Baseline lane for escalations of this remediation. Default infra-config. v1 leaves the
   * health-check entry at default; its app-conformance handoffs are classified dynamically by
   * the probe-guard (see handoff-brief.ts), since only the probe knows a path-mismatch from a timeout. */
  lane?: Lane;
  buildArgs: (res: Record<string, unknown>) => Record<string, unknown>;
}

export const REMEDIATIONS: Record<string, Remediation> = {
  'coolify.enable_healthcheck': {
    tool: 'coolify_update_application',
    risk: 'safe',
    buildArgs: (a) => ({
      uuid: a.uuid,
      health_check_enabled: true,
      // Compose apps serve readiness at /health/ready; single-container apps at /api/health
      // (per the project health-check conventions). verifySafe probes whichever we set here.
      health_check_path: a.build_pack === 'dockercompose' ? '/health/ready' : '/api/health',
      health_check_start_period: 15,
    }),
  },
  'coolify.force_https': {
    tool: 'coolify_update_application',
    risk: 'caution',
    buildArgs: (a) => ({
      uuid: a.uuid,
      domains: String(a.fqdn).replace(/^http:\/\//, 'https://'),
    }),
  },
};

/** The declared lane for a remediation key, defaulting to infra-config. */
export function laneFor(key: string): Lane {
  return REMEDIATIONS[key]?.lane ?? 'infra-config';
}

export function resolveRemediation(
  key: string,
  res: Record<string, unknown>,
): { action: PlannedAction; risk: Risk } | null {
  const r = REMEDIATIONS[key];
  if (!r) return null;
  return { action: { tool: r.tool, args: r.buildArgs(res) }, risk: r.risk };
}
