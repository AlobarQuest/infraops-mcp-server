import type { PlannedAction, Risk } from "./check-engine.js";

interface Remediation {
  tool: string;
  risk: Risk;
  buildArgs: (res: Record<string, unknown>) => Record<string, unknown>;
}

export const REMEDIATIONS: Record<string, Remediation> = {
  "coolify.enable_healthcheck": {
    tool: "coolify_update_application",
    risk: "safe",
    buildArgs: (a) => ({
      uuid: a.uuid,
      health_check_enabled: true,
      health_check_path: "/api/health",
      health_check_start_period: 15,
    }),
  },
  "coolify.force_https": {
    tool: "coolify_update_application",
    risk: "caution",
    buildArgs: (a) => ({
      uuid: a.uuid,
      domains: String(a.fqdn).replace(/^http:\/\//, "https://"),
    }),
  },
};

export function resolveRemediation(
  key: string,
  res: Record<string, unknown>
): { action: PlannedAction; risk: Risk } | null {
  const r = REMEDIATIONS[key];
  if (!r) return null;
  return { action: { tool: r.tool, args: r.buildArgs(res) }, risk: r.risk };
}
