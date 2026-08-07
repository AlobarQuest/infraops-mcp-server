/**
 * Auto-merge must never be able to merge a pull request whose checks are red.
 *
 * This is the single assumption every other control in the routine-change lane rests
 * on. `dependabot-auto-merge.yml` is safe *because* it runs `gh pr merge --auto`, which
 * asks GitHub to merge when the required checks pass and hands enforcement to GitHub.
 * The workflow never inspects CI, and therefore cannot get CI wrong. Given that, the
 * worst a broken merge rule can do is merge something green — which is what makes it
 * acceptable for the rule itself to land unattended (ADR-0016).
 *
 * Remove `--auto`, or add `--admin`, and that assumption is gone. It is a one-word edit,
 * it passes every other check in this repository, and a human reviewer would not reliably
 * catch it in a diff. So the guard is here, in the required check, rather than in a
 * person's attention — which also puts it INSIDE the bound it protects.
 *
 * The Python twin of this file lives in intent-packages, project-standards,
 * security-standards and factory-runner. Same rule, same mutations, different runner —
 * change it everywhere or nowhere.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOWS = resolve(__dirname, '..', '.github', 'workflows');
const AUTO_MERGE_WORKFLOW = join(WORKFLOWS, 'dependabot-auto-merge.yml');

// Ways to merge that do NOT go through GitHub's required-check enforcement.
// `enablePullRequestAutoMerge` would be equivalent to `--auto` and is still refused: if
// the GraphQL route is ever wanted, take that decision openly rather than by having a
// guard fail to mention it.
const BYPASS_PATTERNS: RegExp[] = [
  /--admin\b/,
  /\bmergePullRequest\b/,
  /\bmerge_pull_request\b/,
  /\benablePullRequestAutoMerge\b/,
  /pulls\/[^\s"']*\/merge\b/,
];

const MERGE_COMMAND = /gh\s+pr\s+merge\b/;

/** Join shell line-continuations, so a flag on the next line still belongs to it. */
function logicalLines(text: string): string[] {
  return text.replace(/\\\n\s*/g, ' ').split('\n');
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS)
    .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
    .sort()
    .map((n) => join(WORKFLOWS, n));
}

describe('auto-merge cannot bypass CI', () => {
  it('has an auto-merge workflow at all', () => {
    // A vacuous pass is the failure mode this guard exists to avoid. If auto-merge is
    // ever withdrawn from this repository that is a decision worth making visibly —
    // delete this assertion in the same change, and say why.
    expect(existsSync(AUTO_MERGE_WORKFLOW)).toBe(true);
  });

  it("delegates every merge's enforcement to GitHub", () => {
    const offenders: string[] = [];
    for (const path of workflowFiles()) {
      logicalLines(readFileSync(path, 'utf8')).forEach((line, i) => {
        if (MERGE_COMMAND.test(line) && !line.includes('--auto')) {
          offenders.push(`${path}:${i + 1}: merges without --auto — ${line.trim()}`);
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('has no workflow that can bypass required checks', () => {
    const offenders: string[] = [];
    for (const path of workflowFiles()) {
      logicalLines(readFileSync(path, 'utf8')).forEach((line, i) => {
        for (const pattern of BYPASS_PATTERNS) {
          if (pattern.test(line)) {
            offenders.push(
              `${path}:${i + 1}: ${pattern} bypasses required checks — ${line.trim()}`,
            );
          }
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
