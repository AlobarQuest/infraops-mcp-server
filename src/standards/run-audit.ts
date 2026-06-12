import { coolifyGet } from "../services/coolify-client.js";
import type { CoolifyInstance } from "../services/coolify-client.js";
import { loadCoolifyChecks } from "./standards-source.js";
import { evaluateCheck } from "./check-engine.js";
import { resolveRemediation } from "./remediation-registry.js";
import type { Proposal, Risk } from "./check-engine.js";

export interface AuditResult {
  meta: {
    standards_source: "live" | "cache" | "seed";
    checks_evaluated: number;
    not_audited: number;
    errors?: string[];
  };
  summary: {
    total_proposals: number;
    by_risk: Record<Risk, number>;
    by_kind: { remediation: number; question: number };
  };
  proposals: Proposal[];
}

/**
 * Audit a single Coolify instance against infra-brain standards.
 *
 * Shared by the `coolify_audit_standards` MCP tool and the headless drift CLI so
 * the evaluation logic lives in exactly one place. Read-only: it never mutates.
 *
 * Per-endpoint read failures are captured into `meta.errors` rather than thrown,
 * so a partially-reachable instance still yields whatever proposals it can.
 */
export async function auditInstance(
  instance: CoolifyInstance,
  opts: { scope?: string } = {},
): Promise<AuditResult> {
  const { scope } = opts;
  const { checks, source } = await loadCoolifyChecks();

  const [appsRes, dbsRes] = await Promise.allSettled([
    coolifyGet<Array<Record<string, unknown>>>("/applications", undefined, instance),
    coolifyGet<Array<Record<string, unknown>>>("/databases", undefined, instance),
  ]);

  const errors: string[] = [];
  function extract<T>(result: PromiseSettledResult<T>, label: string): T | null {
    if (result.status === "fulfilled") return result.value;
    errors.push(
      `${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    );
    return null;
  }

  let apps = extract(appsRes, "applications");
  let dbs = extract(dbsRes, "databases");

  if (scope) {
    const s = scope.toLowerCase();
    const matchesScope = (r: Record<string, unknown>) =>
      String(r.uuid ?? "").toLowerCase() === s ||
      String(r.name ?? "").toLowerCase().includes(s);
    if (apps) apps = apps.filter(matchesScope);
    if (dbs) dbs = dbs.filter(matchesScope);
  }

  const appChecks = checks.filter((c) => c.resource === "coolify_application");
  const dbChecks = checks.filter((c) => c.resource === "coolify_database");

  const proposals: Proposal[] = [];
  for (const app of apps ?? []) {
    for (const c of appChecks) {
      const p = evaluateCheck(c, app, resolveRemediation);
      if (p) proposals.push(p);
    }
  }
  for (const db of dbs ?? []) {
    for (const c of dbChecks) {
      const p = evaluateCheck(c, db, resolveRemediation);
      if (p) proposals.push(p);
    }
  }

  const byRisk: Record<Risk, number> = { safe: 0, caution: 0, destructive: 0 };
  const byKind = { remediation: 0, question: 0 };
  for (const p of proposals) {
    byRisk[p.risk]++;
    byKind[p.kind]++;
  }

  return {
    meta: {
      standards_source: source,
      checks_evaluated: checks.length,
      not_audited: 0,
      ...(errors.length > 0 && { errors }),
    },
    summary: {
      total_proposals: proposals.length,
      by_risk: byRisk,
      by_kind: byKind,
    },
    proposals,
  };
}
