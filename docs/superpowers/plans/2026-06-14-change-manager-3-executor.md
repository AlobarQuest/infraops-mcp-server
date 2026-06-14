# Change Manager — Plan 3: Mini-side Sync + Window Executor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]`. **Prerequisite: Plan 2c Part 2 (the deployed change-manager API) must be live** — the live `sync`/`run-window` wiring + verification depend on it, though all code below is unit-tested with a mocked API client and can be *built* beforehand.

> **Execution corrections (applied 2026-06-14 during the build, approved by Devon):**
> 1. **`redeploy_application` triggers a full deploy, not a restart.** An HTTPS domain
>    change only regenerates the Traefik route + Let's Encrypt cert on a full **deploy**;
>    a `restart` leaves the cert stale. The repo's own `reset_labels`
>    (`src/tools/control.ts`) uses `/applications/{uuid}/deploy` for exactly this reason.
>    Task 2 wraps `POST /applications/{uuid}/deploy` (the test asserts `/deploy`).
> 2. **Deterministic pre-validate + post-verify + revert** (the kickoff's CRITICAL
>    CORRECTNESS, the design spec's "Agent safety model"). The original draft only
>    *captured* rollback. The executor now: (a) **pre-validates** live before the agent
>    runs — an already-conformant HTTPS item → `skipped_conformant` (no writes); (b)
>    **post-verifies** after the agent reports `done` — re-fetch live, and if the change
>    didn't actually take (still `http://` / health not enabled) → **revert** via the
>    captured rollback and mark `failed`. `set_application_healthcheck` therefore also
>    captures rollback. `ChangeOutcome.outcome` gains `skipped_conformant`; `run-window`
>    counts it. See Tasks 2–4.

**Goal:** In the `infraops-mcp-server` repo, build the mini-side of the change manager: a `sync` step that pushes the day's escalations to the web app, and a nightly (04:00) windowed agent that pulls approved items and implements the genuinely-automatable ones (HTTPS, health-check) via a **curated** infraops tool surface, reporting outcomes back.

**Architecture:** Mirrors the remediation pipeline's shape (dep-injected core + thin CLI + launchd wrapper). A thin HTTP `api-client` talks to the change-manager API with the M2M token. A narrow `tools` allowlist (the blast-radius boundary) wraps `coolify-client` with validation/idempotency/rollback. An `agent` (Sonnet tool-use loop) reads each escalation + plan as guidance and acts only through those tools. `run-window` orchestrates: claim → re-validate → agent → post outcome, per-item isolation, capped.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), vitest, `@anthropic-ai/sdk` (already a dep), the existing `coolify-client`. Bash + launchd + BWS.

**Spec:** `docs/superpowers/specs/2026-06-14-change-manager-design.md` → "Sub-project B".

**Conventions:** `.js` import specifiers; tests in `tests/`; `npm run build`; `npx vitest run`; `dist/` tracked → rebuilt + committed at the end. Branch off `main`. Reuse `coolifyGet`/`coolifyPatch`/`coolifyPost` from `src/services/coolify-client.ts`.

**Config/secrets (set at deploy, Plan 2c):** `CHANGE_MGR_API_BASE` (e.g. `https://change-mgr.alobar.net`), `CHANGE_MGR_M2M_TOKEN` (BWS, by-UUID), plus the existing Coolify + `ANTHROPIC_API_KEY` env.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/change-manager/api-client.ts` (new) | Typed HTTP client: `postSync`, `getApproved`, `claim`, `postOutcome`, `startWindow`/`finishWindow`. Uses global `fetch`, M2M bearer. |
| `src/change-manager/tools.ts` (new) | The curated tool allowlist (read + `set_application_domains` + `redeploy_application` + `set_application_healthcheck` + `report_blocked`/`report_done`) — JSON-schema defs + handlers wrapping `coolify-client` with validation, idempotency, rollback capture. The blast-radius boundary. |
| `src/change-manager/agent.ts` (new) | `runChangeAgent(item, deps)` — Sonnet tool-use loop over the curated tools; injected Anthropic client; returns a `ChangeOutcome`. |
| `src/change-manager/run-window.ts` (new) | Dep-injected core: pull approved → per item claim/validate/agent/outcome → assemble window summary. |
| `src/change-manager/window-report.ts` (new) | `renderWindowMarkdown()` for the email digest. |
| `src/cli/change-mgr-cli.ts` (new) | `sync` + `run-window` subcommands; wires real deps. |
| `scripts/change-window.sh` (new) | launchd ~04:00 wrapper (BWS by-UUID, run-window, email, Healthchecks). |
| `scripts/com.devon.change-window.plist.template` + `install-change-window-launchd.sh` (new) | Secret-free LaunchAgent install (mirror the drift-audit ones). |
| `tests/change-manager-*.test.ts` (new) | Per-unit tests (mocked fetch / coolify-client / Anthropic). |

---

## Task 1: `api-client.ts`

**Files:** Create `src/change-manager/api-client.ts`, `tests/change-manager-api-client.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/change-manager-api-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChangeMgrClient } from "../src/change-manager/api-client.js";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("ChangeMgrClient", () => {
  it("postSync sends the M2M bearer + body and returns the summary", async () => {
    fetchMock.mockResolvedValue(ok({ new: 1, refreshed: 0, resolved: 0, reopened: 0 }));
    const c = new ChangeMgrClient("https://cm.example", "tok");
    const r = await c.postSync({ generated_at: "t", source_report: "r.json", escalations: [] });
    expect(r.new).toBe(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cm.example/api/sync");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok");
  });

  it("getApproved lists approved items", async () => {
    fetchMock.mockResolvedValue(ok([{ id: 1, status: "approved" }]));
    const c = new ChangeMgrClient("https://cm.example", "tok");
    const items = await c.getApproved();
    expect(items).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/items?status=approved");
  });

  it("claim throws on 409 (already claimed)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, text: async () => "conflict" });
    const c = new ChangeMgrClient("https://cm.example", "tok");
    await expect(c.claim(1)).rejects.toThrow(/409/);
  });
});
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `src/change-manager/api-client.ts`**

```typescript
export interface SyncBody { generated_at: string; source_report: string; escalations: unknown[]; }
export interface SyncSummary { new: number; refreshed: number; resolved: number; reopened: number; }
export interface ApprovedItem {
  id: number; identity: string; instance: string; rule_key: string;
  resource_type: string | null; resource_uuid: string; resource_name: string;
  risk: string; kind: string; reasoning: string; plan: Record<string, unknown>; note: string | null; status: string;
}
export interface OutcomeBody {
  outcome: "done" | "failed" | "blocked" | "skipped_conformant";
  detail?: string; tool_calls?: Record<string, unknown>; rollback?: Record<string, unknown>;
}

export class ChangeMgrClient {
  constructor(private base: string, private token: string) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`change-mgr ${path} -> ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  postSync(body: SyncBody): Promise<SyncSummary> {
    return this.req<SyncSummary>("/api/sync", { method: "POST", body: JSON.stringify(body) });
  }
  getApproved(): Promise<ApprovedItem[]> {
    return this.req<ApprovedItem[]>("/api/items?status=approved");
  }
  claim(id: number): Promise<ApprovedItem> {
    return this.req<ApprovedItem>(`/api/items/${id}/claim`, { method: "POST" });
  }
  postOutcome(id: number, body: OutcomeBody): Promise<unknown> {
    return this.req(`/api/items/${id}/outcome`, { method: "POST", body: JSON.stringify(body) });
  }
  startWindow(startedAt: string): Promise<{ id: number }> {
    return this.req<{ id: number }>("/api/window-runs", { method: "POST", body: JSON.stringify({ started_at: startedAt }) });
  }
  finishWindow(id: number, counts: Record<string, unknown>): Promise<unknown> {
    return this.req(`/api/window-runs/${id}`, { method: "PATCH", body: JSON.stringify(counts) });
  }
}
```

- [ ] **Step 4: Run green** → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/change-manager/api-client.ts tests/change-manager-api-client.test.ts
git commit -m "feat(cm): change-manager API client (M2M)"
```

---

## Task 2: `tools.ts` — the curated tool surface

**Files:** Create `src/change-manager/tools.ts`, `tests/change-manager-tools.test.ts`.

The agent may call ONLY these. Each write captures a rollback value and is idempotent (re-reads, no-ops if already conformant). `report_blocked`/`report_done` are control tools that end the loop.

- [ ] **Step 1: Write the failing test** — `tests/change-manager-tools.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

const coolifyGet = vi.fn();
const coolifyPatch = vi.fn();
const coolifyPost = vi.fn();
vi.mock("../src/services/coolify-client.js", () => ({ coolifyGet, coolifyPatch, coolifyPost }));

import { TOOLS, runTool, httpsConformant, revertRollback } from "../src/change-manager/tools.js";

beforeEach(() => { coolifyGet.mockReset(); coolifyPatch.mockReset(); coolifyPost.mockReset(); });

describe("curated tools", () => {
  it("exposes only the allowlisted tools", () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_application", "redeploy_application", "report_blocked", "report_done",
      "set_application_domains", "set_application_healthcheck",
    ]);
  });

  it("set_application_domains http->https captures rollback + PATCHes", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", fqdn: "http://x.com", domains: "http://x.com" });
    coolifyPatch.mockResolvedValue({});
    const ctx = { instance: "prod" as const, rollback: {} as Record<string, unknown> };
    const out = await runTool("set_application_domains", { uuid: "u1", domains: "https://x.com" }, ctx);
    expect(coolifyPatch).toHaveBeenCalledWith("/applications/u1", { domains: "https://x.com", force_domain_override: true }, "prod");
    expect(ctx.rollback.domains).toBe("http://x.com");  // original captured
    expect(out).toMatch(/updated/i);
  });

  it("set_application_healthcheck captures rollback + PATCHes the health fields", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", health_check_enabled: false, health_check_path: null, health_check_port: null });
    coolifyPatch.mockResolvedValue({});
    const ctx = { instance: "prod" as const, rollback: {} as Record<string, unknown> };
    await runTool("set_application_healthcheck", { uuid: "u1", path: "/health", port: 3000 }, ctx);
    expect(coolifyPatch).toHaveBeenCalledWith("/applications/u1",
      { health_check_enabled: true, health_check_path: "/health", health_check_port: 3000 }, "prod");
    expect(ctx.rollback.health_check_enabled).toBe(false);  // original captured
  });

  it("redeploy_application POSTs a full deploy (regenerates routing/cert, not just restart)", async () => {
    coolifyPost.mockResolvedValue({});
    const ctx = { instance: "prod" as const, rollback: {} };
    await runTool("redeploy_application", { uuid: "u1" }, ctx);
    expect(coolifyPost).toHaveBeenCalledWith("/applications/u1/deploy", undefined, "prod");
  });

  it("an unknown tool throws (defense in depth)", async () => {
    await expect(runTool("rm_rf", {}, { instance: "prod", rollback: {} })).rejects.toThrow(/unknown tool/i);
  });
});

describe("conformance helpers + revert", () => {
  it("httpsConformant: true only when every domain is https", () => {
    expect(httpsConformant({ domains: "https://x.com" })).toBe(true);
    expect(httpsConformant({ domains: "https://x.com,https://y.com" })).toBe(true);
    expect(httpsConformant({ domains: "http://x.com" })).toBe(false);
    expect(httpsConformant({ domains: "https://x.com,http://y.com" })).toBe(false);
    expect(httpsConformant({ fqdn: "https://x.com" })).toBe(true);
    expect(httpsConformant({})).toBe(false);
  });

  it("revertRollback restores captured domains via force_domain_override", async () => {
    coolifyPatch.mockResolvedValue({});
    await revertRollback("u1", { domains: "http://x.com" }, "prod");
    expect(coolifyPatch).toHaveBeenCalledWith("/applications/u1",
      { domains: "http://x.com", force_domain_override: true }, "prod");
  });

  it("revertRollback restores captured health fields", async () => {
    coolifyPatch.mockResolvedValue({});
    await revertRollback("u1", { health_check_enabled: false, health_check_path: null, health_check_port: null }, "prod");
    expect(coolifyPatch).toHaveBeenCalledWith("/applications/u1",
      { health_check_enabled: false, health_check_path: null, health_check_port: null }, "prod");
  });

  it("revertRollback with an empty rollback is a no-op", async () => {
    await revertRollback("u1", {}, "prod");
    expect(coolifyPatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `src/change-manager/tools.ts`**

```typescript
import { coolifyGet, coolifyPatch, coolifyPost } from "../services/coolify-client.js";
import type { CoolifyInstance } from "../services/coolify-client.js";

export interface ToolCtx { instance: CoolifyInstance; rollback: Record<string, unknown>; }

/** JSON-schema tool definitions handed to the model. Read tools + the two write tools + control tools. */
export const TOOLS = [
  { name: "get_application", description: "Read a Coolify application's current config.",
    input_schema: { type: "object", properties: { uuid: { type: "string" } }, required: ["uuid"] } },
  { name: "set_application_domains",
    description: "Set an application's domains (e.g. change http:// to https://). Captures the original for rollback.",
    input_schema: { type: "object", properties: { uuid: { type: "string" }, domains: { type: "string", description: "comma-separated https URLs" } }, required: ["uuid", "domains"] } },
  { name: "set_application_healthcheck",
    description: "Enable an application's health check at a verified path/port.",
    input_schema: { type: "object", properties: { uuid: { type: "string" }, path: { type: "string" }, port: { type: "number" } }, required: ["uuid", "path", "port"] } },
  { name: "redeploy_application", description: "Restart/redeploy an application so routing/cert changes take effect.",
    input_schema: { type: "object", properties: { uuid: { type: "string" } }, required: ["uuid"] } },
  { name: "report_done", description: "Call when the remediation is complete and verified.",
    input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } },
  { name: "report_blocked", description: "Call when the change cannot be completed (missing prerequisite or needs human judgment).",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } },
] as const;

const NAMES = new Set(TOOLS.map((t) => t.name));

/** Execute one tool call. Write tools capture rollback + validate. Throws on unknown tool (defense in depth). */
export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  if (!NAMES.has(name)) throw new Error(`unknown tool: ${name}`);
  const uuid = String(args.uuid ?? "");

  switch (name) {
    case "get_application": {
      const app = await coolifyGet<Record<string, unknown>>(`/applications/${uuid}`, undefined, ctx.instance);
      return JSON.stringify({ uuid, fqdn: app.fqdn, domains: app.domains, status: app.status,
        health_check_enabled: app.health_check_enabled, health_check_path: app.health_check_path });
    }
    case "set_application_domains": {
      const domains = String(args.domains ?? "");
      if (!domains.startsWith("https://")) throw new Error("domains must be https://");
      const app = await coolifyGet<Record<string, unknown>>(`/applications/${uuid}`, undefined, ctx.instance);
      ctx.rollback.domains = app.domains ?? app.fqdn ?? null;  // capture original
      await coolifyPatch(`/applications/${uuid}`, { domains, force_domain_override: true }, ctx.instance);
      return `domains updated to ${domains}`;
    }
    case "set_application_healthcheck": {
      const path = String(args.path ?? ""), port = Number(args.port);
      if (!path.startsWith("/") || !Number.isInteger(port)) throw new Error("path must start with / and port must be an integer");
      const app = (await coolifyGet<Record<string, unknown>>(`/applications/${uuid}`, undefined, ctx.instance)) ?? {};
      ctx.rollback.health_check_enabled = app.health_check_enabled ?? false;  // capture original for revert
      ctx.rollback.health_check_path = app.health_check_path ?? null;
      ctx.rollback.health_check_port = app.health_check_port ?? null;
      await coolifyPatch(`/applications/${uuid}`,
        { health_check_enabled: true, health_check_path: path, health_check_port: port }, ctx.instance);
      return `health check enabled at ${path}:${port}`;
    }
    case "redeploy_application": {
      // Full deploy (not restart): only a deploy regenerates Traefik routing + the
      // Let's Encrypt cert after a domain change. Mirrors reset_labels in control.ts.
      await coolifyPost(`/applications/${uuid}/deploy`, undefined, ctx.instance);
      return "redeploy (full deploy) triggered";
    }
    // report_done / report_blocked are handled by the agent loop (control tools); never reach here as writes
    default:
      throw new Error(`tool ${name} is a control tool, not a write`);
  }
}

/** True only when every domain on the app is https:// — the HTTPS post-/pre-verify check. */
export function httpsConformant(app: Record<string, unknown>): boolean {
  const raw = String(app.domains ?? app.fqdn ?? "");
  const urls = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return urls.length > 0 && urls.every((u) => u.startsWith("https://"));
}

/** Revert a captured rollback (domains and/or health fields). Best-effort; idempotent per-dimension. */
export async function revertRollback(uuid: string, rollback: Record<string, unknown>, instance: CoolifyInstance): Promise<void> {
  if (rollback.domains != null) {
    await coolifyPatch(`/applications/${uuid}`, { domains: String(rollback.domains), force_domain_override: true }, instance);
  }
  if (rollback.health_check_enabled !== undefined) {
    await coolifyPatch(`/applications/${uuid}`, {
      health_check_enabled: rollback.health_check_enabled,
      health_check_path: rollback.health_check_path ?? null,
      health_check_port: rollback.health_check_port ?? null,
    }, instance);
  }
}
```

- [ ] **Step 4: Run green** → all passed (`report_done`/`report_blocked` aren't executed by `runTool` — the agent loop intercepts them; the allowlist test still lists them).

- [ ] **Step 5: Commit**

```bash
git add src/change-manager/tools.ts tests/change-manager-tools.test.ts
git commit -m "feat(cm): curated tool surface (HTTPS + health-check) with rollback + validation"
```

---

## Task 3: `agent.ts` — the Sonnet tool-use loop

**Files:** Create `src/change-manager/agent.ts`, `tests/change-manager-agent.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/change-manager-agent.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

const coolifyGet = vi.fn();
const coolifyPatch = vi.fn();
const coolifyPost = vi.fn();
vi.mock("../src/services/coolify-client.js", () => ({ coolifyGet, coolifyPatch, coolifyPost }));

import { runChangeAgent } from "../src/change-manager/agent.js";
import type { ApprovedItem } from "../src/change-manager/api-client.js";

beforeEach(() => { coolifyGet.mockReset(); coolifyPatch.mockReset(); coolifyPost.mockReset(); });

function item(): ApprovedItem {
  return { id: 1, identity: "prod::571::u1", instance: "prod", rule_key: "571",
    resource_type: "application", resource_uuid: "u1", resource_name: "mirror",
    risk: "caution", kind: "remediation", reasoning: "must be https", plan: { steps: ["set https", "redeploy"] },
    note: null, status: "in_progress" };
}

// A fake Anthropic client whose .messages.create returns a scripted sequence of turns.
function fakeAnthropic(turns: any[]) {
  let i = 0;
  return { messages: { create: vi.fn(async () => turns[i++]) } } as any;
}

const textTurn = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const toolTurn = (name: string, input: any) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name, input }] });

describe("runChangeAgent", () => {
  it("runs tool calls then report_done → outcome done (post-verify passes) with tool_calls recorded", async () => {
    // Stateful Coolify: starts http; the domains PATCH flips it to https so post-verify passes.
    let domains = "http://x.com";
    coolifyGet.mockImplementation(async () => ({ uuid: "u1", domains, fqdn: domains }));
    coolifyPatch.mockImplementation(async (_p: string, body: any) => { if (body?.domains) domains = body.domains; return {}; });
    coolifyPost.mockResolvedValue({});
    const client = fakeAnthropic([
      toolTurn("set_application_domains", { uuid: "u1", domains: "https://x.com" }),
      toolTurn("redeploy_application", { uuid: "u1" }),
      toolTurn("report_done", { summary: "https enabled + redeployed" }),
    ]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("done");
    expect(out.detail).toMatch(/https enabled/);
    expect(out.rollback.domains).toBe("http://x.com");
    expect(out.tool_calls.calls.length).toBe(3);
  });

  it("already-conformant HTTPS item → skipped_conformant before any write", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", domains: "https://x.com", fqdn: "https://x.com" });
    const create = vi.fn();
    const client = { messages: { create } } as any;
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("skipped_conformant");
    expect(create).not.toHaveBeenCalled();         // agent loop never ran
    expect(coolifyPatch).not.toHaveBeenCalled();    // nothing written
  });

  it("post-verify failure → revert + failed (agent claims done but domains still http)", async () => {
    // coolifyGet always returns http (the change never actually took); patch is a no-op.
    coolifyGet.mockResolvedValue({ uuid: "u1", domains: "http://x.com", fqdn: "http://x.com" });
    coolifyPatch.mockResolvedValue({}); coolifyPost.mockResolvedValue({});
    const client = fakeAnthropic([
      toolTurn("set_application_domains", { uuid: "u1", domains: "https://x.com" }),
      toolTurn("report_done", { summary: "claims done" }),
    ]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("failed");
    expect(out.detail).toMatch(/post-verify/i);
    // revert PATCHed domains back to the captured original
    expect(coolifyPatch).toHaveBeenCalledWith("/applications/u1",
      { domains: "http://x.com", force_domain_override: true }, "prod");
  });

  it("report_blocked → outcome blocked with reason", async () => {
    coolifyGet.mockResolvedValue(undefined);  // pre-validate can't confirm conformance → proceeds to the loop
    const client = fakeAnthropic([toolTurn("report_blocked", { reason: "no health endpoint" })]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    expect(out.outcome).toBe("blocked");
    expect(out.detail).toMatch(/no health endpoint/);
  });

  it("hitting maxSteps without a report → failed", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", domains: "http://x.com" });
    const client = fakeAnthropic(Array(20).fill(toolTurn("get_application", { uuid: "u1" })));
    const out = await runChangeAgent(item(), { client, maxSteps: 3 });
    expect(out.outcome).toBe("failed");
  });

  it("a tool error → failed (never throws)", async () => {
    coolifyGet.mockResolvedValue({ uuid: "u1", domains: "http://x.com" });
    coolifyPatch.mockRejectedValue(new Error("boom"));
    const client = fakeAnthropic([
      toolTurn("set_application_domains", { uuid: "u1", domains: "https://x.com" }),
      toolTurn("report_done", { summary: "done" }),
    ]);
    const out = await runChangeAgent(item(), { client, maxSteps: 10 });
    // the tool error is fed back to the model as a tool_result error; the recorded tool_calls capture it.
    expect(out.tool_calls.calls.some((c: any) => /boom/.test(JSON.stringify(c)))).toBe(true);
  });
});
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `src/change-manager/agent.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { coolifyGet, type CoolifyInstance } from "../services/coolify-client.js";
import type { ApprovedItem } from "./api-client.js";
import { TOOLS, runTool, httpsConformant, revertRollback, type ToolCtx } from "./tools.js";

export interface ChangeOutcome {
  outcome: "done" | "blocked" | "failed" | "skipped_conformant";
  detail: string;
  rollback: Record<string, unknown>;
  tool_calls: { calls: Array<{ name: string; input: unknown; result: string }> };
}

type ToolCalls = ChangeOutcome["tool_calls"]["calls"];

export interface AgentDeps { client?: Anthropic; maxSteps?: number; }

/** Heuristic: is this an HTTPS-enable remediation (the one type we live-pre/post-verify)? */
function isHttpsRemediation(item: ApprovedItem): boolean {
  const blob = `${item.rule_key} ${item.reasoning} ${JSON.stringify(item.plan)}`.toLowerCase();
  return item.rule_key === "571" || blob.includes("https") || blob.includes("http://");
}

/** Pre-validate live: an already-conformant HTTPS item needs no change → skip it (no writes). */
async function preValidateConformant(item: ApprovedItem, ctx: ToolCtx): Promise<boolean> {
  if (!isHttpsRemediation(item)) return false;
  try {
    const app = await coolifyGet<Record<string, unknown>>(`/applications/${item.resource_uuid}`, undefined, ctx.instance);
    return !!app && httpsConformant(app);
  } catch {
    return false; // can't confirm → let the agent try
  }
}

/**
 * Post-verify a 'done': re-fetch live and confirm the change actually took. If not,
 * revert via the captured rollback and return a 'failed' outcome to substitute.
 * Returns null to keep 'done'. A post-verify *read* error is inconclusive → keep 'done'
 * (don't revert a possibly-good change on a transient read failure).
 */
async function postVerifyOrRevert(item: ApprovedItem, ctx: ToolCtx, calls: ToolCalls): Promise<ChangeOutcome | null> {
  try {
    if (ctx.rollback.domains !== undefined) {
      const app = await coolifyGet<Record<string, unknown>>(`/applications/${item.resource_uuid}`, undefined, ctx.instance);
      if (!app || !httpsConformant(app)) {
        await revertRollback(item.resource_uuid, ctx.rollback, ctx.instance).catch(() => {});
        return { outcome: "failed", detail: "post-verify failed: domains not https after change; reverted via rollback", rollback: ctx.rollback, tool_calls: { calls } };
      }
    }
    if (ctx.rollback.health_check_enabled !== undefined) {
      const app = await coolifyGet<Record<string, unknown>>(`/applications/${item.resource_uuid}`, undefined, ctx.instance);
      if (!app || app.health_check_enabled !== true) {
        await revertRollback(item.resource_uuid, ctx.rollback, ctx.instance).catch(() => {});
        return { outcome: "failed", detail: "post-verify failed: health check not enabled after change; reverted via rollback", rollback: ctx.rollback, tool_calls: { calls } };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function buildSystem(): string {
  return [
    "You are an infrastructure change executor for a Coolify platform.",
    "Implement the approved remediation using ONLY the provided tools.",
    "Read the resource first if useful. For HTTPS: set the domains to https:// then redeploy.",
    "For health-checks: only enable if you can supply a path the app actually serves; otherwise report_blocked.",
    "When the change is complete, call report_done with a short summary.",
    "If you cannot complete it (missing prerequisite, no safe path, or needs a human decision), call report_blocked with the reason.",
    "Never invent tools. Make the minimal change.",
  ].join("\n");
}

function buildUserMessage(item: ApprovedItem): string {
  return [
    `Resource: ${item.resource_type} '${item.resource_name}' (uuid ${item.resource_uuid}, instance ${item.instance})`,
    `Deviation: ${item.reasoning}`,
    `Guidance plan (advisory; tool names in it may be wrong — use only the provided tools): ${JSON.stringify(item.plan)}`,
  ].join("\n");
}

/**
 * Run one approved item through the Sonnet tool-use loop. Acts only via the curated tools.
 * Never throws: any failure resolves to outcome "failed". report_done → done; report_blocked → blocked;
 * exceeding maxSteps without a report → failed.
 */
export async function runChangeAgent(item: ApprovedItem, deps: AgentDeps = {}): Promise<ChangeOutcome> {
  const client = deps.client ?? new Anthropic();
  const maxSteps = deps.maxSteps ?? 12;
  const ctx: ToolCtx = { instance: item.instance as CoolifyInstance, rollback: {} };
  const calls: ToolCalls = [];

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserMessage(item) }];

  try {
    // Pre-validate live: already-conformant → skip without running the agent or writing.
    if (await preValidateConformant(item, ctx)) {
      return { outcome: "skipped_conformant", detail: "already conformant live; no change needed", rollback: ctx.rollback, tool_calls: { calls } };
    }

    for (let step = 0; step < maxSteps; step++) {
      const res: Anthropic.Message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: buildSystem(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: TOOLS as any,
        messages,
      });
      messages.push({ role: "assistant", content: res.content });

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) {
        // model ended without a control tool → treat as failed (no completion signal)
        return { outcome: "failed", detail: "agent ended without report_done/blocked", rollback: ctx.rollback, tool_calls: { calls } };
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (tu.name === "report_done") {
          const summary = String((tu.input as { summary?: string }).summary ?? "done");
          calls.push({ name: tu.name, input: tu.input, result: summary });
          const reverted = await postVerifyOrRevert(item, ctx, calls);
          return reverted ?? { outcome: "done", detail: summary, rollback: ctx.rollback, tool_calls: { calls } };
        }
        if (tu.name === "report_blocked") {
          const reason = String((tu.input as { reason?: string }).reason ?? "blocked");
          calls.push({ name: tu.name, input: tu.input, result: reason });
          return { outcome: "blocked", detail: reason, rollback: ctx.rollback, tool_calls: { calls } };
        }
        // a write/read tool
        let result: string;
        let isError = false;
        try {
          result = await runTool(tu.name, tu.input as Record<string, unknown>, ctx);
        } catch (e) {
          result = e instanceof Error ? e.message : String(e);
          isError = true;
        }
        calls.push({ name: tu.name, input: tu.input, result });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result, is_error: isError });
      }
      messages.push({ role: "user", content: toolResults });
    }
    return { outcome: "failed", detail: "exceeded max steps", rollback: ctx.rollback, tool_calls: { calls } };
  } catch (e) {
    return { outcome: "failed", detail: e instanceof Error ? e.message : String(e), rollback: ctx.rollback, tool_calls: { calls } };
  }
}
```

- [ ] **Step 4: Run green** → all passed. Then `npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add src/change-manager/agent.ts tests/change-manager-agent.test.ts
git commit -m "feat(cm): Sonnet tool-use agent over the curated surface (done/blocked/failed)"
```

---

## Task 4: `run-window.ts` — orchestration core

**Files:** Create `src/change-manager/run-window.ts`, `tests/change-manager-run-window.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/change-manager-run-window.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runWindow, type WindowDeps } from "../src/change-manager/run-window.js";
import type { ApprovedItem } from "../src/change-manager/api-client.js";

function item(id: number): ApprovedItem {
  return { id, identity: `prod::571::u${id}`, instance: "prod", rule_key: "571",
    resource_type: "application", resource_uuid: `u${id}`, resource_name: `app${id}`,
    risk: "caution", kind: "remediation", reasoning: "https", plan: {}, note: null, status: "approved" };
}

function deps(over: Partial<WindowDeps> = {}): WindowDeps {
  return {
    getApproved: vi.fn(async () => [item(1)]),
    claim: vi.fn(async () => undefined),
    runAgent: vi.fn(async () => ({ outcome: "done" as const, detail: "ok", rollback: {}, tool_calls: { calls: [] } })),
    postOutcome: vi.fn(async () => undefined),
    maxChangesPerWindow: 5,
    ...over,
  };
}

describe("runWindow", () => {
  it("claims, runs the agent, and posts the outcome for each approved item", async () => {
    const d = deps();
    const summary = await runWindow(d);
    expect(d.claim).toHaveBeenCalledWith(1);
    expect(d.runAgent).toHaveBeenCalledTimes(1);
    expect(d.postOutcome).toHaveBeenCalledWith(1, expect.objectContaining({ outcome: "done" }));
    expect(summary).toMatchObject({ considered: 1, applied: 1, failed: 0, blocked: 0 });
  });

  it("caps at maxChangesPerWindow", async () => {
    const many = [item(1), item(2), item(3)];
    const d = deps({ getApproved: vi.fn(async () => many), maxChangesPerWindow: 2 });
    const summary = await runWindow(d);
    expect(d.runAgent).toHaveBeenCalledTimes(2);
    expect(summary.considered).toBe(2);
  });

  it("a claim 409 skips that item without aborting the batch", async () => {
    const d = deps({
      getApproved: vi.fn(async () => [item(1), item(2)]),
      claim: vi.fn(async (id: number) => { if (id === 1) throw new Error("409 conflict"); }),
    });
    const summary = await runWindow(d);
    expect(d.runAgent).toHaveBeenCalledTimes(1); // only item 2 ran
    expect(summary.applied).toBe(1);
  });

  it("blocked + failed outcomes are counted and reported", async () => {
    const d = deps({
      getApproved: vi.fn(async () => [item(1), item(2)]),
      runAgent: vi.fn(async (it: ApprovedItem) => it.id === 1
        ? { outcome: "blocked" as const, detail: "no S3", rollback: {}, tool_calls: { calls: [] } }
        : { outcome: "failed" as const, detail: "boom", rollback: {}, tool_calls: { calls: [] } }),
    });
    const summary = await runWindow(d);
    expect(summary).toMatchObject({ applied: 0, blocked: 1, failed: 1 });
  });

  it("skipped_conformant is counted as skipped and still posts its outcome", async () => {
    const d = deps({
      runAgent: vi.fn(async () => ({ outcome: "skipped_conformant" as const, detail: "already https", rollback: {}, tool_calls: { calls: [] } })),
    });
    const summary = await runWindow(d);
    expect(summary).toMatchObject({ considered: 1, applied: 0, skipped: 1 });
    expect(d.postOutcome).toHaveBeenCalledWith(1, expect.objectContaining({ outcome: "skipped_conformant" }));
  });
});
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `src/change-manager/run-window.ts`**

```typescript
import type { ApprovedItem, OutcomeBody } from "./api-client.js";
import type { ChangeOutcome } from "./agent.js";

export interface WindowDeps {
  getApproved: () => Promise<ApprovedItem[]>;
  claim: (id: number) => Promise<void>;
  runAgent: (item: ApprovedItem) => Promise<ChangeOutcome>;
  postOutcome: (id: number, body: OutcomeBody) => Promise<void>;
  maxChangesPerWindow: number;
}

export interface WindowSummary {
  considered: number; applied: number; failed: number; blocked: number; skipped: number;
  results: Array<{ name: string; outcome: string; detail: string }>;
}

/**
 * The window executor core. Pulls approved items, claims each (skipping on a 409/claim error),
 * runs the agent, posts the outcome. Per-item isolation; capped at maxChangesPerWindow.
 */
export async function runWindow(deps: WindowDeps): Promise<WindowSummary> {
  const approved = (await deps.getApproved()).slice(0, deps.maxChangesPerWindow);
  const summary: WindowSummary = { considered: 0, applied: 0, failed: 0, blocked: 0, skipped: 0, results: [] };

  for (const item of approved) {
    summary.considered++;
    try {
      await deps.claim(item.id); // 409 if no longer approved → skip
    } catch {
      summary.skipped++;
      summary.results.push({ name: item.resource_name, outcome: "skipped", detail: "claim failed (already claimed?)" });
      continue;
    }

    let outcome: ChangeOutcome;
    try {
      outcome = await deps.runAgent(item);
    } catch (e) {
      outcome = { outcome: "failed", detail: e instanceof Error ? e.message : String(e), rollback: {}, tool_calls: { calls: [] } };
    }

    if (outcome.outcome === "done") summary.applied++;
    else if (outcome.outcome === "blocked") summary.blocked++;
    else if (outcome.outcome === "skipped_conformant") summary.skipped++;
    else summary.failed++;
    summary.results.push({ name: item.resource_name, outcome: outcome.outcome, detail: outcome.detail });

    await deps.postOutcome(item.id, {
      outcome: outcome.outcome, detail: outcome.detail,
      tool_calls: outcome.tool_calls, rollback: outcome.rollback,
    });
  }
  return summary;
}
```

- [ ] **Step 4: Run green** → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/change-manager/run-window.ts tests/change-manager-run-window.test.ts
git commit -m "feat(cm): run-window core (claim/agent/outcome, isolation, cap)"
```

---

## Task 5: `window-report.ts` — digest

**Files:** Create `src/change-manager/window-report.ts`, `tests/change-manager-window-report.test.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { renderWindowMarkdown } from "../src/change-manager/window-report.js";

describe("renderWindowMarkdown", () => {
  it("renders headline + per-item outcomes", () => {
    const md = renderWindowMarkdown("2026-06-15T04:00:00Z", {
      considered: 3, applied: 1, failed: 1, blocked: 1, skipped: 0,
      results: [
        { name: "mirror", outcome: "done", detail: "https enabled" },
        { name: "watchtower", outcome: "blocked", detail: "no health endpoint" },
        { name: "crm", outcome: "failed", detail: "redeploy timeout" },
      ],
    });
    expect(md).toContain("# Change Window");
    expect(md).toContain("1 applied");
    expect(md).toContain("mirror");
    expect(md).toContain("no health endpoint");
  });

  it("renders cleanly on an empty window", () => {
    const md = renderWindowMarkdown("t", { considered: 0, applied: 0, failed: 0, blocked: 0, skipped: 0, results: [] });
    expect(md).toMatch(/no approved changes|nothing/i);
  });
});
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `src/change-manager/window-report.ts`**

```typescript
import type { WindowSummary } from "./run-window.js";

export function renderWindowMarkdown(generatedAt: string, s: WindowSummary): string {
  const lines: string[] = [];
  lines.push(`# Change Window — ${generatedAt}`);
  lines.push("");
  lines.push(`**${s.applied} applied**, ${s.blocked} blocked, ${s.failed} failed, ${s.skipped} skipped (of ${s.considered} considered).`);
  lines.push("");
  if (!s.results.length) {
    lines.push("_No approved changes this window._");
    return lines.join("\n");
  }
  for (const r of s.results) {
    const icon = r.outcome === "done" ? "✅" : r.outcome === "blocked" ? "⏸️" : r.outcome === "skipped" ? "⏭️" : "❌";
    lines.push(`- ${icon} **${r.name}** — ${r.outcome}: ${r.detail}`);
  }
  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run green** → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/change-manager/window-report.ts tests/change-manager-window-report.test.ts
git commit -m "feat(cm): window report digest"
```

---

## Task 6: `change-mgr-cli.ts` — sync + run-window

**Files:** Create `src/cli/change-mgr-cli.ts`, `tests/change-mgr-cli.test.ts`.

The CLI mirrors `remediate-cli.ts`: a unit-tested `parseArgs`, and a guarded `main()` that wires real deps. `sync` reads the latest `<date>.remediation.json` and POSTs its `escalations`; `run-window` wires the API client + the real agent into `runWindow`, writes/ emails the digest, exits.

- [ ] **Step 1: Write the failing test** — `tests/change-mgr-cli.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli/change-mgr-cli.js";

describe("change-mgr-cli parseArgs", () => {
  it("parses the subcommand and flags", () => {
    const a = parseArgs(["run-window", "--report-dir", "/r", "--now", "2026-06-15T04:00:00Z"]);
    expect(a.command).toBe("run-window");
    expect(a["report-dir"]).toBe("/r");
    expect(a.now).toBe("2026-06-15T04:00:00Z");
  });
  it("captures sync as the command", () => {
    expect(parseArgs(["sync", "--report-dir", "/r"]).command).toBe("sync");
  });
});
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `src/cli/change-mgr-cli.ts`** (the env wiring mirrors `remediate-cli.ts`; `CHANGE_MGR_API_BASE` + `CHANGE_MGR_M2M_TOKEN` come from BWS via the shell):

```typescript
#!/usr/bin/env node
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { ChangeMgrClient } from "../change-manager/api-client.js";
import { runChangeAgent } from "../change-manager/agent.js";
import { runWindow } from "../change-manager/run-window.js";
import { renderWindowMarkdown } from "../change-manager/window-report.js";

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  if (argv[0] && !argv[0].startsWith("--")) args.command = argv[0];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { args[key] = next; i++; }
    else args[key] = true;
  }
  return args;
}

function client(): ChangeMgrClient {
  const base = process.env.CHANGE_MGR_API_BASE ?? "";
  const token = process.env.CHANGE_MGR_M2M_TOKEN ?? "";
  if (!base || !token) throw new Error("CHANGE_MGR_API_BASE and CHANGE_MGR_M2M_TOKEN must be set");
  return new ChangeMgrClient(base, token);
}

async function doSync(reportDir: string, now: string): Promise<void> {
  const date = now.slice(0, 10);
  const file = path.join(reportDir, `${date}.remediation.json`);
  const report = JSON.parse(fs.readFileSync(file, "utf-8")) as { escalations: unknown[] };
  const summary = await client().postSync({ generated_at: now, source_report: `${date}.remediation.json`, escalations: report.escalations ?? [] });
  process.stdout.write(`synced: ${JSON.stringify(summary)}\n`);
}

async function doRunWindow(reportDir: string | undefined, now: string): Promise<void> {
  const c = client();
  const anthropic = new Anthropic();
  const wr = await c.startWindow(now);
  const summary = await runWindow({
    getApproved: () => c.getApproved(),
    claim: async (id) => { await c.claim(id); },
    runAgent: (item) => runChangeAgent(item, { client: anthropic }),
    postOutcome: async (id, body) => { await c.postOutcome(id, body); },
    maxChangesPerWindow: Number.parseInt(process.env.MAX_CHANGES_PER_WINDOW ?? "5", 10) || 5,
  });
  await c.finishWindow(wr.id, { status: "done", considered: summary.considered, applied: summary.applied,
    failed: summary.failed, blocked: summary.blocked, skipped: summary.skipped,
    report_md: renderWindowMarkdown(now, summary) });
  const md = renderWindowMarkdown(now, summary);
  if (reportDir) fs.writeFileSync(path.join(reportDir, `${now.slice(0, 10)}.change-window.md`), md, "utf-8");
  process.stdout.write(md + "\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = typeof args.now === "string" ? args.now : new Date().toISOString();
  const reportDir = typeof args["report-dir"] === "string" ? (args["report-dir"] as string) : undefined;
  if (args.command === "sync") {
    if (!reportDir) throw new Error("sync requires --report-dir");
    await doSync(reportDir, now);
  } else if (args.command === "run-window") {
    await doRunWindow(reportDir, now);
  } else {
    throw new Error(`unknown command: ${String(args.command)} (use sync | run-window)`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("change-mgr-cli.js")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
```

- [ ] **Step 4: Run green** → 2 passed. Then `npm run build` clean; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/cli/change-mgr-cli.ts tests/change-mgr-cli.test.ts
git commit -m "feat(cm): change-mgr CLI (sync + run-window)"
```

---

## Task 7: Scheduling + sync chaining + dist

**Files:** Create `scripts/change-window.sh`, `scripts/com.devon.change-window.plist.template`, `scripts/install-change-window-launchd.sh`; modify `scripts/drift-audit.sh`; rebuild `dist/`.

- [ ] **Step 1: Chain `sync` into the daily job.** In `scripts/drift-audit.sh`, after the remediate step (and after `ANTHROPIC_API_KEY`/secrets), add the change-mgr secrets (by-UUID, see the operational note) and a best-effort sync:

```bash
export CHANGE_MGR_API_BASE="${CHANGE_MGR_API_BASE:-https://change-mgr.alobar.net}"
export CHANGE_MGR_M2M_TOKEN="$(get_secret_by_id "${BWS_CHANGE_MGR_M2M_SECRET_ID:-<uuid-here>}")"
# Best-effort: push escalations to the change manager (a CM outage must not fail the heartbeat)
node "$REPO/dist/cli/change-mgr-cli.js" sync --report-dir "$REPORT_DIR" --now "$NOW" >>"$LOG_FILE" 2>&1 \
  && log "change-mgr sync ok" || log "WARN: change-mgr sync failed (non-fatal)"
```
(Set `BWS_CHANGE_MGR_M2M_SECRET_ID` to the BWS UUID created in Plan 2c Task 3.)

- [ ] **Step 2: Create `scripts/change-window.sh`** — mirror `drift-audit.sh`'s structure: source the env file for `BWS_ACCESS_TOKEN`/`INFRADRIFT_HC_PING_URL`; fetch Coolify + `ANTHROPIC_API_KEY` + `CHANGE_MGR_M2M_TOKEN` by-UUID; `export CHANGE_MGR_API_BASE`; run `node "$REPO/dist/cli/change-mgr-cli.js" run-window --report-dir "$REPORT_DIR" --now "$NOW"`; email the `<date>.change-window.md` via Resend; ping a NEW Healthchecks.io check. Pin a separate HC check URL (`INFRADRIFT_CW_HC_PING_URL`).

- [ ] **Step 3: Create `scripts/com.devon.change-window.plist.template`** — copy the drift template; `Label` = `com.devon.change-window`, `ProgramArguments` → `scripts/change-window.sh`, `StartCalendarInterval` Hour **4** Minute **0**.

- [ ] **Step 4: Create `scripts/install-change-window-launchd.sh`** — copy `install-drift-launchd.sh`; render `com.devon.change-window.plist`, `unload`/`load`. Reuse the same `~/.config/infra-drift/env` (same bootstrap secrets).

- [ ] **Step 5: `bash -n`** all three scripts → no errors.

- [ ] **Step 6: Rebuild + commit dist + scripts**

```bash
cd ~/Projects/infraops-mcp-server
npm run clean && npm run build
npx vitest run   # all green
git add src/ scripts/ tests/ dist/
git commit -m "feat(cm): 04:00 change-window launchd + sync chaining + dist"
```

- [ ] **Step 7: Push / merge to main** (code only — the live launchd install + the BWS `BWS_CHANGE_MGR_M2M_SECRET_ID` are operational, done once the app is deployed).

---

## Operational follow-ups (after merge; done with Devon, post-deploy)
1. Create the `change-manager/M2M_TOKEN` mirror the mini reads (same secret as the app's `M2M_TOKEN`); record its BWS UUID as `BWS_CHANGE_MGR_M2M_SECRET_ID` in the env / script default.
2. `bash scripts/install-change-window-launchd.sh` to arm the 04:00 window.
3. First-run: approve one HTTPS item in the GUI, `launchctl start com.devon.change-window`, watch the log + the window digest email, confirm the change landed and the item shows `done` with the tool-call audit.

---

## Self-Review (completed by plan author)
- **Spec coverage:** sync push (Task 6 `doSync` + Task 7 chaining); the curated tool surface = the blast-radius boundary (Task 2, HTTPS + health-check only, unknown-tool throws); the Sonnet agent acting only via those tools with done/blocked/failed + tool-call audit + rollback capture (Task 3); run-window claim→validate→agent→outcome with per-item isolation + `MAX_CHANGES_PER_WINDOW` cap (Task 4); the digest (Task 5); 04:00 launchd + best-effort sync that never fails the heartbeat (Task 7).
- **Safety:** the agent can only call allowlisted tools (`runTool` throws on anything else); writes capture rollback + validate inputs (https-only domains, /-prefixed health path); claim's 409 guard prevents double-processing; the cap bounds blast radius; the agent never throws (failures → `failed`). Re-validation: the GUI only surfaces `approved` items the human chose, and `claim` re-checks status server-side; an item already conformant would have the agent `report_done` quickly (a future enhancement could add an explicit pre-validate skip like the remediation pipeline's — noted, not built, to keep scope tight).
- **Type/name consistency:** `ApprovedItem`/`OutcomeBody` (api-client) flow into `agent`/`run-window`; `ChangeOutcome` is produced by `runChangeAgent` and consumed by `runWindow`/`postOutcome`; `WindowSummary` flows into `renderWindowMarkdown`; the CLI wires them with the real `ChangeMgrClient` + `runChangeAgent`.
- **Placeholders:** the only fill-in is `<uuid-here>` for `BWS_CHANGE_MGR_M2M_SECRET_ID` (Task 7) — a real secret UUID that only exists after Plan 2c Task 3 creates it; flagged at the step.
- **Anthropic SDK note:** the agent uses the standard `messages.create` tool-use loop (manual loop for control over the `report_done`/`report_blocked` stop signal). If the installed SDK's tool/param types differ, adjust the call shape (the behavior — loop, execute curated tools, stop on a control tool — is fixed). Model `claude-sonnet-4-6` per the design.
