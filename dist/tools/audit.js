import { z } from "zod";
import { CoolifyInstanceSchema } from "../schemas/common.js";
import { auditInstance } from "../standards/run-audit.js";
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
        const output = await auditInstance(instance, { scope });
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
    });
}
//# sourceMappingURL=audit.js.map