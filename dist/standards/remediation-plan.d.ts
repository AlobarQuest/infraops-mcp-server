import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import type { Proposal } from './check-engine.js';
/** The structured remediation plan Sonnet returns for one escalated proposal. */
export declare const RemediationPlanSchema: z.ZodObject<{
    generated_by: z.ZodEnum<["sonnet", "raw"]>;
    root_cause: z.ZodString;
    steps: z.ZodArray<z.ZodString, "many">;
    infraops_tools: z.ZodArray<z.ZodString, "many">;
    risk: z.ZodEnum<["safe", "caution", "destructive"]>;
    rollback: z.ZodString;
    cm_window_hint: z.ZodString;
}, "strip", z.ZodTypeAny, {
    risk: "safe" | "caution" | "destructive";
    rollback: string;
    generated_by: "sonnet" | "raw";
    root_cause: string;
    steps: string[];
    infraops_tools: string[];
    cm_window_hint: string;
}, {
    risk: "safe" | "caution" | "destructive";
    rollback: string;
    generated_by: "sonnet" | "raw";
    root_cause: string;
    steps: string[];
    infraops_tools: string[];
    cm_window_hint: string;
}>;
export type RemediationPlan = z.infer<typeof RemediationPlanSchema>;
/** Schema sent to the model — same shape minus generated_by, which we stamp ourselves. */
export declare const PlanModelSchema: z.ZodObject<Omit<{
    generated_by: z.ZodEnum<["sonnet", "raw"]>;
    root_cause: z.ZodString;
    steps: z.ZodArray<z.ZodString, "many">;
    infraops_tools: z.ZodArray<z.ZodString, "many">;
    risk: z.ZodEnum<["safe", "caution", "destructive"]>;
    rollback: z.ZodString;
    cm_window_hint: z.ZodString;
}, "generated_by">, "strip", z.ZodTypeAny, {
    risk: "safe" | "caution" | "destructive";
    rollback: string;
    root_cause: string;
    steps: string[];
    infraops_tools: string[];
    cm_window_hint: string;
}, {
    risk: "safe" | "caution" | "destructive";
    rollback: string;
    root_cause: string;
    steps: string[];
    infraops_tools: string[];
    cm_window_hint: string;
}>;
/** Deterministic prompt for one escalated proposal. No timestamps/randomness (keeps tests + caching stable). */
export declare function buildPlanPrompt(p: Proposal): string;
/**
 * Ask Sonnet to plan one escalated proposal. The client is injected for testing;
 * in production we construct a default Anthropic() (reads ANTHROPIC_API_KEY).
 * Best-effort: any failure or empty parse degrades to the deterministic raw
 * fallback so the pipeline never blocks on the model.
 *
 * Model is claude-sonnet-4-6 by explicit choice (plan quality over executor cost).
 */
/**
 * AutoParseableOutputFormat built from a zod v3 schema via zod-to-json-schema.
 * The SDK's zodOutputFormat() helper uses zod/v4 internally and is incompatible
 * with zod v3 schemas at runtime, so we route through jsonSchemaOutputFormat instead —
 * the SDK's own strict-transform helper that strips unsupported keys (like $schema)
 * and forces additionalProperties:false recursively, producing an API-valid schema.
 * We override the base parse with a zod-validated parse so the model output is
 * type-checked against PlanModelSchema before the pipeline uses it.
 *
 * Exported so it can be unit-tested directly (the format is the real network path).
 */
export declare function planOutputFormat(): {
    parse: (content: string) => {
        risk: "safe" | "caution" | "destructive";
        rollback: string;
        root_cause: string;
        steps: string[];
        infraops_tools: string[];
        cm_window_hint: string;
    };
    schema: {
        [key: string]: unknown;
    };
    type: "json_schema";
};
export declare function planEscalation(p: Proposal, client?: Anthropic): Promise<RemediationPlan>;
/** Deterministic fallback when Sonnet is unreachable — keeps the pipeline flowing. */
export declare function rawFallback(p: Proposal): RemediationPlan;
//# sourceMappingURL=remediation-plan.d.ts.map