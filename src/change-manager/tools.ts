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

const NAMES = new Set<string>(TOOLS.map((t) => t.name));

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
      const domainList = domains.split(",").map((s) => s.trim()).filter(Boolean);
      if (!domainList.length || !domainList.every((u) => u.startsWith("https://"))) {
        throw new Error("domains must be comma-separated https:// URLs");
      }
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
