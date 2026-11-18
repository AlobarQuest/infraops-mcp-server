import type { ApprovedItem, OutcomeBody } from './api-client.js';
import type { ChangeOutcome } from './agent.js';

export type Instance = 'prod' | 'dev';

export interface SelectOptions {
  maxChangesPerWindow: number;
  /** Keep only items for this Coolify instance; undefined keeps both. */
  instance?: Instance;
}

export interface WindowDeps extends SelectOptions {
  getApproved: () => Promise<ApprovedItem[]>;
  claim: (id: number) => Promise<void>;
  runAgent: (item: ApprovedItem) => Promise<ChangeOutcome>;
  postOutcome: (id: number, body: OutcomeBody) => Promise<void>;
}

export interface WindowSummary {
  considered: number;
  applied: number;
  failed: number;
  blocked: number;
  skipped: number;
  results: Array<{ name: string; outcome: string; detail: string }>;
}

/**
 * The items a window would claim, in order. A dry run and a real run both select through here.
 * The instance filter runs before the cap, so items for the other instance never use up a slot.
 */
export function selectItems(items: ApprovedItem[], opts: SelectOptions): ApprovedItem[] {
  // Security and rotation items are not the Coolify Sonnet agent's: nothing here runs a security
  // item (its plan is a manual checklist), and the orchestrator's rotation service owns a rotation.
  return items
    .filter((i) => i.source !== 'security' && i.source !== 'rotation')
    .filter((i) => opts.instance === undefined || i.instance === opts.instance)
    .slice(0, opts.maxChangesPerWindow);
}

/**
 * The window executor core. Pulls approved items, claims each (skipping on a 409/claim error),
 * runs the agent, posts the outcome. Per-item isolation; capped at maxChangesPerWindow.
 */
export async function runWindow(deps: WindowDeps): Promise<WindowSummary> {
  const approved = selectItems(await deps.getApproved(), deps);
  const summary: WindowSummary = {
    considered: 0,
    applied: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    results: [],
  };

  for (const item of approved) {
    summary.considered++;
    try {
      await deps.claim(item.id); // 409 if no longer approved → skip
    } catch {
      summary.skipped++;
      summary.results.push({
        name: item.resource_name,
        outcome: 'skipped',
        detail: 'claim failed (already claimed?)',
      });
      continue;
    }

    let outcome: ChangeOutcome;
    try {
      outcome = await deps.runAgent(item);
    } catch (e) {
      outcome = {
        outcome: 'failed',
        detail: e instanceof Error ? e.message : String(e),
        rollback: {},
        tool_calls: { calls: [] },
      };
    }

    if (outcome.outcome === 'done') summary.applied++;
    else if (outcome.outcome === 'blocked') summary.blocked++;
    else if (outcome.outcome === 'skipped_conformant') summary.skipped++;
    else summary.failed++;

    const result = { name: item.resource_name, outcome: outcome.outcome, detail: outcome.detail };
    summary.results.push(result);

    try {
      await deps.postOutcome(item.id, {
        outcome: outcome.outcome,
        detail: outcome.detail,
        tool_calls: outcome.tool_calls,
        rollback: outcome.rollback,
      });
    } catch (e) {
      // Recording the outcome failed (transient API error). The change itself already
      // happened; don't abort the batch — note it on the item so the digest surfaces it.
      result.detail += ` [WARN: outcome post failed: ${e instanceof Error ? e.message : String(e)}]`;
    }
  }
  return summary;
}
