import { z } from "zod";
import { coolifyGet } from "../services/coolify-client.js";
import { CoolifyInstanceSchema } from "../schemas/common.js";
import { loadCoolifyChecks } from "../standards/standards-source.js";
import { evaluateCheck } from "../standards/check-engine.js";
import { resolveRemediation } from "../standards/remediation-registry.js";
export function registerAuditTools(server) {
    server.registerTool("coolify_audit_standards", {
        title: "Audit Coolify Resources Against Standards",
        description: "Scan all (or one) Coolify application and database against infra-brain standards " +
            "(fetched from infra-brain's REST API; cached fallback). Returns proposals — each a " +
            "deviation paired with a concrete remediation tool-call. Read-only: applies nothing.",
        inputSchema: {
            scope: z.string().optional().describe("Optional app/db name or UUID to limit the audit to one resource"),
            categories: z.array(z.string()).optional().describe("Optional check categories to include (default: all)"),
            now: z.string().optional().describe("ISO timestamp for age-based checks; caller supplies for determinism"),
            instance: CoolifyInstanceSchema,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    }, async ({ scope, instance }) => {
        const { checks, source } = await loadCoolifyChecks();
        const [appsRes, dbsRes] = await Promise.allSettled([
            coolifyGet("/applications", undefined, instance),
            coolifyGet("/databases", undefined, instance),
        ]);
        const errors = [];
        function extract(result, label) {
            if (result.status === "fulfilled")
                return result.value;
            errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
            return null;
        }
        let apps = extract(appsRes, "applications");
        let dbs = extract(dbsRes, "databases");
        // Apply scope filter
        if (scope) {
            const s = scope.toLowerCase();
            const matchesScope = (r) => String(r.uuid ?? "").toLowerCase() === s ||
                String(r.name ?? "").toLowerCase().includes(s);
            if (apps)
                apps = apps.filter(matchesScope);
            if (dbs)
                dbs = dbs.filter(matchesScope);
        }
        const appChecks = checks.filter((c) => c.resource === "coolify_application");
        const dbChecks = checks.filter((c) => c.resource === "coolify_database");
        const proposals = [];
        for (const app of apps ?? []) {
            for (const c of appChecks) {
                const p = evaluateCheck(c, app, resolveRemediation);
                if (p)
                    proposals.push(p);
            }
        }
        for (const db of dbs ?? []) {
            for (const c of dbChecks) {
                const p = evaluateCheck(c, db, resolveRemediation);
                if (p)
                    proposals.push(p);
            }
        }
        const byRisk = { safe: 0, caution: 0, destructive: 0 };
        const byKind = { remediation: 0, question: 0 };
        for (const p of proposals) {
            byRisk[p.risk]++;
            byKind[p.kind]++;
        }
        const output = {
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
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
    });
}
//# sourceMappingURL=audit.js.map