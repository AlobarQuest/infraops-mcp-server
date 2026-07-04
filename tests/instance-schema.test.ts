import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoolifyInstanceSchema, CoolifyInstanceRequiredSchema } from '../src/schemas/common.js';

// ── Shared schema behavior ───────────────────────────────────────────
describe('Coolify instance schemas', () => {
  it('read schema defaults to prod when instance is omitted', () => {
    expect(CoolifyInstanceSchema.parse(undefined)).toBe('prod');
  });

  it('required schema rejects an omitted instance (no silent prod default)', () => {
    expect(CoolifyInstanceRequiredSchema.safeParse(undefined).success).toBe(false);
  });

  it('both schemas accept explicit prod/dev and reject anything else', () => {
    for (const schema of [CoolifyInstanceSchema, CoolifyInstanceRequiredSchema]) {
      expect(schema.parse('dev')).toBe('dev');
      expect(schema.parse('prod')).toBe('prod');
      expect(schema.safeParse('staging').success).toBe(false);
    }
  });
});

// ── Tool-level enforcement ───────────────────────────────────────────
// The footgun: a bare mutating call must NOT default to prod. Capture each tool's
// registered inputSchema and assert mutating tools require `instance` while reads
// still default. This guards against a new mutating tool being wired to the wrong
// schema.
const captured: Record<string, any> = {};
const mockServer = {
  registerTool: vi.fn((name: string, schema: any) => {
    captured[name] = schema;
  }),
};

vi.mock('../src/services/coolify-client.js', () => ({
  coolifyGet: vi.fn(),
  coolifyPost: vi.fn(),
  coolifyPatch: vi.fn(),
  coolifyDelete: vi.fn(),
  handleCoolifyError: vi.fn((e) => `Error: ${e}`),
}));

import { registerDeploymentTools } from '../src/tools/deployments.js';
import { registerApplicationTools } from '../src/tools/applications.js';
import { registerControlTools } from '../src/tools/control.js';

const instanceOf = (tool: string) => captured[tool].inputSchema.instance;

describe('mutating Coolify tools require an explicit instance', () => {
  beforeEach(() => {
    for (const k of Object.keys(captured)) delete captured[k];
    registerDeploymentTools(mockServer as any);
    registerApplicationTools(mockServer as any);
    registerControlTools(mockServer as any);
  });

  it.each([
    'coolify_deploy',
    'coolify_create_application_public',
    'coolify_update_application',
    'coolify_delete_application',
    'coolify_control',
  ])('%s rejects a missing instance', (tool) => {
    expect(instanceOf(tool).safeParse(undefined).success).toBe(false);
    expect(instanceOf(tool).parse('dev')).toBe('dev');
  });

  it.each([
    'coolify_list_deployments',
    'coolify_get_deployment',
    'coolify_list_applications',
    'coolify_get_application',
    'coolify_overview',
  ])('%s still defaults to prod (read-only convenience)', (tool) => {
    expect(instanceOf(tool).parse(undefined)).toBe('prod');
  });
});
