import type { CoolifyInstance } from '../services/coolify-client.js';
import type { Proposal, Risk } from './check-engine.js';
export interface AuditResult {
    meta: {
        standards_source: 'live' | 'cache' | 'seed';
        checks_evaluated: number;
        not_audited: number;
        errors?: string[];
    };
    summary: {
        total_proposals: number;
        by_risk: Record<Risk, number>;
        by_kind: {
            remediation: number;
            question: number;
        };
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
export declare function auditInstance(instance: CoolifyInstance, opts?: {
    scope?: string;
}): Promise<AuditResult>;
//# sourceMappingURL=run-audit.d.ts.map