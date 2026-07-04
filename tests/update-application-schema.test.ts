import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Regression for the bug where coolify_update_application received empty args
// ({} → "uuid Required") because `custom_labels: z.string().nullable()` emitted
// a JSON-Schema array-type union (`"type": ["string","null"]`) that the MCP
// client could not serialize, so it dropped the ENTIRE arguments object.
//
// Guards:
//   1. No property in the emitted JSON schema uses an array-type union — that is
//      the exact construct that breaks the client.
//   2. The Zod schema accepts a representative args object.
//   3. The handler is actually invoked with those args (reaches coolifyPatch).

const captured: Record<string, { schema: any; handler: any }> = {};
const mockServer = {
  registerTool: vi.fn((name: string, schema: any, handler: any) => {
    captured[name] = { schema, handler };
  }),
};

const coolifyPatch = vi.fn(async () => ({ uuid: 'v04wc0wos0o0440k0ok8g08k' }));
vi.mock('../src/services/coolify-client.js', () => ({
  coolifyGet: vi.fn(),
  coolifyPost: vi.fn(),
  coolifyPatch: (...args: unknown[]) => coolifyPatch(...args),
  coolifyDelete: vi.fn(),
  handleCoolifyError: vi.fn((e) => `Error: ${e}`),
}));

import { registerApplicationTools } from '../src/tools/applications.js';

const REPRESENTATIVE = {
  uuid: 'v04wc0wos0o0440k0ok8g08k',
  domains: '',
  custom_labels: '',
  health_check_enabled: false,
  instance: 'prod' as const,
};

// Recursively assert no `type` field is an array (the client-incompatible union shape).
function assertNoArrayTypeUnions(node: unknown, path = '$'): void {
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.type)) {
    throw new Error(
      `array-type union at ${path}: ${JSON.stringify(obj.type)} — clients drop args on this construct`,
    );
  }
  for (const [k, v] of Object.entries(obj)) {
    assertNoArrayTypeUnions(v, `${path}.${k}`);
  }
}

describe('coolify_update_application client-compatible schema', () => {
  beforeEach(() => {
    for (const k of Object.keys(captured)) delete captured[k];
    coolifyPatch.mockClear();
    registerApplicationTools(mockServer as any);
  });

  it('emits no array-type union in its JSON schema', () => {
    const shape = captured['coolify_update_application'].schema.inputSchema;
    const json = zodToJsonSchema(z.object(shape));
    expect(() => assertNoArrayTypeUnions(json)).not.toThrow();
  });

  it('accepts a representative args object', () => {
    const shape = captured['coolify_update_application'].schema.inputSchema;
    const parsed = z.object(shape).safeParse(REPRESENTATIVE);
    expect(parsed.success).toBe(true);
  });

  it('invokes the handler with those args, reaching coolifyPatch', async () => {
    const { handler } = captured['coolify_update_application'];
    await handler(REPRESENTATIVE);
    expect(coolifyPatch).toHaveBeenCalledTimes(1);
    const [path, body] = coolifyPatch.mock.calls[0];
    expect(path).toBe('/applications/v04wc0wos0o0440k0ok8g08k');
    expect(body).toMatchObject({ domains: '', custom_labels: '', health_check_enabled: false });
  });
});
