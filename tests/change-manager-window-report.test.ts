import { describe, it, expect } from 'vitest';
import { renderWindowMarkdown } from '../src/change-manager/window-report.js';

describe('renderWindowMarkdown', () => {
  it('renders headline + per-item outcomes', () => {
    const md = renderWindowMarkdown('2026-06-15T04:00:00Z', {
      considered: 3,
      applied: 1,
      failed: 1,
      blocked: 1,
      skipped: 0,
      results: [
        { name: 'mirror', outcome: 'done', detail: 'https enabled' },
        { name: 'watchtower', outcome: 'blocked', detail: 'no health endpoint' },
        { name: 'crm', outcome: 'failed', detail: 'redeploy timeout' },
      ],
    });
    expect(md).toContain('# Change Window');
    expect(md).toContain('1 applied');
    expect(md).toContain('mirror');
    expect(md).toContain('no health endpoint');
    expect(md).toContain('✅ **mirror**');
    expect(md).toContain('⏸️ **watchtower**');
    expect(md).toContain('❌ **crm**');
  });

  it('renders cleanly on an empty window', () => {
    const md = renderWindowMarkdown('t', {
      considered: 0,
      applied: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      results: [],
    });
    expect(md).toMatch(/no approved changes|nothing/i);
    expect(md).toContain('_No approved changes this window._');
  });

  it('renders a skipped_conformant item with the skip icon, not the failure icon', () => {
    const md = renderWindowMarkdown('t', {
      considered: 1,
      applied: 0,
      failed: 0,
      blocked: 0,
      skipped: 1,
      results: [{ name: 'imap', outcome: 'skipped_conformant', detail: 'already https' }],
    });
    expect(md).toContain('⏭️ **imap**');
    expect(md).not.toContain('❌');
  });
});
