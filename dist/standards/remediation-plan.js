import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { zodToJsonSchema } from 'zod-to-json-schema';
/** The structured remediation plan Sonnet returns for one escalated proposal. */
export const RemediationPlanSchema = z.object({
    generated_by: z.enum(['sonnet', 'raw']),
    root_cause: z.string(),
    steps: z.array(z.string()),
    infraops_tools: z.array(z.string()),
    risk: z.enum(['safe', 'caution', 'destructive']),
    rollback: z.string(),
    cm_window_hint: z.string(),
});
/** Schema sent to the model — same shape minus generated_by, which we stamp ourselves. */
export const PlanModelSchema = RemediationPlanSchema.omit({ generated_by: true });
/** Deterministic prompt for one escalated proposal. No timestamps/randomness (keeps tests + caching stable). */
export function buildPlanPrompt(p) {
    return [
        'You are an infrastructure change planner for a Coolify-based platform.',
        'A daily standards audit flagged the following deviation that cannot be auto-fixed.',
        'Write a concrete remediation plan a careful operator (or a change-manager process) can execute.',
        '',
        `Resource: ${p.target.resource_type} '${p.target.name}' (uuid ${p.target.uuid}, provider ${p.target.provider})`,
        `Deviation: ${p.description}`,
        `Why it matters: ${p.reasoning}`,
        p.question ? `Open question: ${p.question}` : '',
        '',
        "Infrastructure context: changes are made via the infraops MCP server's coolify_* tools",
        '(e.g. coolify_update_application, coolify_create_scheduled_task, coolify_update_database).',
        'Domains follow appname.devonwatkins.com; secrets live in Bitwarden Secrets Manager.',
        '',
        'Return: root cause, ordered concrete steps, which infraops tools to use, the risk of',
        'the fix itself (safe/caution/destructive), how to roll back, and a change-window hint.',
    ]
        .filter(Boolean)
        .join('\n');
}
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
export function planOutputFormat() {
    const rawSchema = zodToJsonSchema(PlanModelSchema, {
        $refStrategy: 'none',
    });
    const base = jsonSchemaOutputFormat(rawSchema);
    return {
        ...base,
        parse: (content) => {
            const result = PlanModelSchema.safeParse(JSON.parse(content));
            if (!result.success)
                throw new Error(result.error.message);
            return result.data;
        },
    };
}
export async function planEscalation(p, client) {
    try {
        // Construct inside the try: a missing ANTHROPIC_API_KEY makes the SDK
        // constructor throw, and that must degrade to the raw fallback like any
        // other plan-gen failure — never block the (model-free) safe-apply path.
        const anthropic = client ?? new Anthropic();
        const res = await anthropic.messages.parse({
            model: 'claude-sonnet-4-6',
            max_tokens: 16000,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium', format: planOutputFormat() },
            messages: [{ role: 'user', content: buildPlanPrompt(p) }],
        });
        const parsed = res
            .parsed_output;
        if (!parsed)
            return rawFallback(p);
        return { ...parsed, generated_by: 'sonnet' };
    }
    catch {
        return rawFallback(p);
    }
}
/** Deterministic fallback when Sonnet is unreachable — keeps the pipeline flowing. */
export function rawFallback(p) {
    return {
        generated_by: 'raw',
        root_cause: p.reasoning,
        steps: [
            p.question ?? p.description,
            'Review manually and choose the appropriate infraops remediation.',
        ],
        infraops_tools: [],
        risk: p.risk,
        rollback: 'n/a — manual review required before any change.',
        cm_window_hint: 'Review during the next scheduled change-management window.',
    };
}
//# sourceMappingURL=remediation-plan.js.map