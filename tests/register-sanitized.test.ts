import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installRedaction, ALWAYS_BYPASS } from "../src/utils/register-sanitized.js";

const PEM = "-----BEGIN OPENSSH PRIVATE KEY-----\nzzz\n-----END OPENSSH PRIVATE KEY-----";

// Minimal fake McpServer capturing registered handlers.
function fakeServer() {
  const handlers: Record<string, Function> = {};
  const configs: Record<string, any> = {};
  return {
    registerTool(name: string, config: any, cb: Function) { configs[name] = config; handlers[name] = cb; },
    handlers, configs,
  };
}

const secretResult = () => ({ content: [{ type: "text", text: JSON.stringify({ private_key: PEM, status: "ok" }) }] });

describe("installRedaction", () => {
  afterEach(() => { delete process.env.INFRAOPS_DISABLE_REDACTION; });

  it("redacts a tool's secret output by default", async () => {
    const s = fakeServer(); installRedaction(s as any);
    s.registerTool("coolify_get_deployment", { inputSchema: {} }, async () => secretResult());
    const r = await s.handlers["coolify_get_deployment"]({}, {});
    expect(r.content[0].text).toContain("***");
    expect(r.content[0].text).not.toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(r.content[0].text).toContain("ok");
  });

  it("bypasses redaction when reveal:true", async () => {
    const s = fakeServer(); installRedaction(s as any);
    s.registerTool("coolify_get_deployment", { inputSchema: {} }, async () => secretResult());
    const r = await s.handlers["coolify_get_deployment"]({ reveal: true }, {});
    expect(r.content[0].text).toContain("BEGIN OPENSSH PRIVATE KEY");
  });

  it("bypasses redaction for ALWAYS_BYPASS tools", async () => {
    const s = fakeServer(); installRedaction(s as any);
    s.registerTool("vps_read_file", { inputSchema: {} }, async () => secretResult());
    const r = await s.handlers["vps_read_file"]({}, {});
    expect(r.content[0].text).toContain("BEGIN OPENSSH PRIVATE KEY");
  });

  it("kill switch disables redaction", async () => {
    process.env.INFRAOPS_DISABLE_REDACTION = "1";
    const s = fakeServer(); installRedaction(s as any);
    s.registerTool("coolify_get_deployment", { inputSchema: {} }, async () => secretResult());
    const r = await s.handlers["coolify_get_deployment"]({}, {});
    expect(r.content[0].text).toContain("BEGIN OPENSSH PRIVATE KEY");
  });

  it("injects reveal into schema only when absent", async () => {
    const s = fakeServer(); installRedaction(s as any);
    const existing = { reveal: { _tag: "preexisting" } };
    s.registerTool("has_reveal", { inputSchema: existing }, async () => secretResult());
    s.registerTool("no_reveal", { inputSchema: {} }, async () => secretResult());
    expect((s.configs["has_reveal"].inputSchema.reveal as any)._tag).toBe("preexisting");
    expect(s.configs["no_reveal"].inputSchema.reveal).toBeDefined();
  });

  it("redacts error responses too", async () => {
    const s = fakeServer(); installRedaction(s as any);
    s.registerTool("coolify_get_deployment", { inputSchema: {} },
      async () => ({ isError: true, content: [{ type: "text", text: `failed: ${PEM}` }] }));
    const r = await s.handlers["coolify_get_deployment"]({}, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).not.toContain("BEGIN OPENSSH PRIVATE KEY");
  });

  it("ALWAYS_BYPASS holds the value-read tools", () => {
    for (const t of ["vps_read_file","vps_exec","vps_docker_logs","cloudflare_get_kv_value","cloudflare_query_d1","namecheap_domains_get_contacts"])
      expect(ALWAYS_BYPASS.has(t)).toBe(true);
  });

  it("does NOT truncate ALWAYS_BYPASS output (value-reads stay whole), but truncates others", async () => {
    const s = fakeServer(); installRedaction(s as any);
    const big = "z".repeat(40000);
    s.registerTool("vps_read_file", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: big }] }));
    s.registerTool("coolify_get_application", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify({ blob: big }) }] }));
    const raw = await s.handlers["vps_read_file"]({}, {});
    const cut = await s.handlers["coolify_get_application"]({}, {});
    expect(raw.content[0].text.length).toBe(40000);
    expect(cut.content[0].text).toContain("truncated:");
  });
});
