import { describe, it, expect, vi } from 'vitest';
import { runWindow, type WindowDeps } from '../src/change-manager/run-window.js';
import type { ApprovedItem } from '../src/change-manager/api-client.js';

function item(id: number): ApprovedItem {
  return {
    id,
    identity: `prod::coolify.force_https::u${id}`,
    instance: 'prod',
    rule_key: 'coolify.force_https',
    resource_type: 'application',
    resource_uuid: `u${id}`,
    resource_name: `app${id}`,
    risk: 'caution',
    kind: 'remediation',
    reasoning: 'https',
    plan: {},
    note: null,
    status: 'approved',
  };
}

function deps(over: Partial<WindowDeps> = {}): WindowDeps {
  return {
    getApproved: vi.fn(async () => [item(1)]),
    claim: vi.fn(async () => undefined),
    runAgent: vi.fn(async () => ({
      outcome: 'done' as const,
      detail: 'ok',
      rollback: {},
      tool_calls: { calls: [] },
    })),
    postOutcome: vi.fn(async () => undefined),
    maxChangesPerWindow: 5,
    ...over,
  };
}

describe('runWindow', () => {
  it('claims, runs the agent, and posts the outcome for each approved item', async () => {
    const d = deps();
    const summary = await runWindow(d);
    expect(d.claim).toHaveBeenCalledWith(1);
    expect(d.runAgent).toHaveBeenCalledTimes(1);
    expect(d.postOutcome).toHaveBeenCalledWith(1, expect.objectContaining({ outcome: 'done' }));
    expect(summary).toMatchObject({ considered: 1, applied: 1, failed: 0, blocked: 0 });
  });

  it('caps at maxChangesPerWindow', async () => {
    const many = [item(1), item(2), item(3)];
    const d = deps({ getApproved: vi.fn(async () => many), maxChangesPerWindow: 2 });
    const summary = await runWindow(d);
    expect(d.runAgent).toHaveBeenCalledTimes(2);
    expect(summary.considered).toBe(2);
  });

  it('a claim 409 skips that item without aborting the batch', async () => {
    const d = deps({
      getApproved: vi.fn(async () => [item(1), item(2)]),
      claim: vi.fn(async (id: number) => {
        if (id === 1) throw new Error('409 conflict');
      }),
    });
    const summary = await runWindow(d);
    expect(d.runAgent).toHaveBeenCalledTimes(1); // only item 2 ran
    expect(summary).toMatchObject({ applied: 1, skipped: 1 });
  });

  it('blocked + failed outcomes are counted and reported', async () => {
    const d = deps({
      getApproved: vi.fn(async () => [item(1), item(2)]),
      runAgent: vi.fn(async (it: ApprovedItem) =>
        it.id === 1
          ? {
              outcome: 'blocked' as const,
              detail: 'no S3',
              rollback: {},
              tool_calls: { calls: [] },
            }
          : { outcome: 'failed' as const, detail: 'boom', rollback: {}, tool_calls: { calls: [] } },
      ),
    });
    const summary = await runWindow(d);
    expect(summary).toMatchObject({ applied: 0, blocked: 1, failed: 1 });
  });

  it('skipped_conformant is counted as skipped and still posts its outcome', async () => {
    const d = deps({
      runAgent: vi.fn(async () => ({
        outcome: 'skipped_conformant' as const,
        detail: 'already https',
        rollback: {},
        tool_calls: { calls: [] },
      })),
    });
    const summary = await runWindow(d);
    expect(summary).toMatchObject({ considered: 1, applied: 0, skipped: 1 });
    expect(d.postOutcome).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ outcome: 'skipped_conformant' }),
    );
  });

  it('a postOutcome failure does not abort the batch', async () => {
    const d = deps({
      getApproved: vi.fn(async () => [item(1), item(2)]),
      postOutcome: vi.fn(async (id: number) => {
        if (id === 1) throw new Error('network');
      }),
    });
    const summary = await runWindow(d);
    expect(d.runAgent).toHaveBeenCalledTimes(2); // batch continued to item 2
    expect(summary.applied).toBe(2);
    expect(summary.results[0].detail).toMatch(/post failed/i);
  });

  it('surfaces a getApproved failure to the caller (abort cleanly, nothing applied)', async () => {
    const d = deps({
      getApproved: vi.fn(async () => {
        throw new Error('unreachable');
      }),
    });
    await expect(runWindow(d)).rejects.toThrow(/unreachable/);
  });
});
