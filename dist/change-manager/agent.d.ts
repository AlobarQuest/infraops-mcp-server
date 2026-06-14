import Anthropic from "@anthropic-ai/sdk";
import type { ApprovedItem } from "./api-client.js";
export interface ChangeOutcome {
    outcome: "done" | "blocked" | "failed" | "skipped_conformant";
    detail: string;
    rollback: Record<string, unknown>;
    tool_calls: {
        calls: Array<{
            name: string;
            input: unknown;
            result: string;
        }>;
    };
}
export interface AgentDeps {
    client?: Anthropic;
    maxSteps?: number;
}
/**
 * Run one approved item through the Sonnet tool-use loop. Acts only via the curated tools.
 * Never throws: any failure resolves to outcome "failed". report_done → done; report_blocked → blocked;
 * exceeding maxSteps without a report → failed.
 */
export declare function runChangeAgent(item: ApprovedItem, deps?: AgentDeps): Promise<ChangeOutcome>;
//# sourceMappingURL=agent.d.ts.map