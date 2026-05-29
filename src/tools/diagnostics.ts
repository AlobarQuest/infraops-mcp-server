import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { coolifyGet, handleCoolifyError } from "../services/coolify-client.js";
import { CoolifyInstanceSchema } from "../schemas/common.js";
import type { CoolifyInstance } from "../services/coolify-client.js";

// ── UUID resolvers ────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAppUuid(query: string, instance: CoolifyInstance): Promise<string> {
  if (UUID_RE.test(query)) return query;
  const apps = await coolifyGet<Array<{ uuid: string; name?: string; fqdn?: string }>>(
    "/applications",
    undefined,
    instance
  );
  const q = query.toLowerCase();
  const matches = apps.filter(
    (a) => a.name?.toLowerCase().includes(q) || a.fqdn?.toLowerCase().includes(q)
  );
  if (matches.length === 0) throw new Error(`No application found matching "${query}"`);
  if (matches.length > 1) {
    const list = matches.map((a) => `${a.name} (${a.fqdn ?? "no domain"})`).join(", ");
    throw new Error(`Multiple applications match "${query}": ${list}. Use a UUID or be more specific.`);
  }
  return matches[0].uuid;
}

async function resolveServerUuid(query: string, instance: CoolifyInstance): Promise<string> {
  if (UUID_RE.test(query)) return query;
  const servers = await coolifyGet<Array<{ uuid: string; name?: string; ip?: string }>>(
    "/servers",
    undefined,
    instance
  );
  const q = query.toLowerCase();
  const matches = servers.filter(
    (s) => s.name?.toLowerCase().includes(q) || s.ip?.toLowerCase().includes(q)
  );
  if (matches.length === 0) throw new Error(`No server found matching "${query}"`);
  if (matches.length > 1) {
    const list = matches.map((s) => `${s.name} (${s.ip})`).join(", ");
    throw new Error(`Multiple servers match "${query}": ${list}. Use a UUID or be more specific.`);
  }
  return matches[0].uuid;
}

// ── Tool registration ─────────────────────────────────────────────────

export function registerDiagnosticTools(server: McpServer): void {
  // ── diagnose_app ─────────────────────────────────────────────────────

  server.registerTool(
    "coolify_diagnose_app",
    {
      title: "Diagnose Application",
      description:
        "Composite diagnostic for an application: fans out to fetch details, recent logs, " +
        "env var count, and deployment history in parallel. " +
        "Accepts UUID, app name, or FQDN/domain.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Application UUID, name, or domain (FQDN)"),
        log_lines: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Number of log lines to fetch (default: 50)"),
        instance: CoolifyInstanceSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, log_lines, instance }: { query: string; log_lines: number; instance: CoolifyInstance }) => {
      let uuid: string;
      try {
        uuid = await resolveAppUuid(query, instance);
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        };
      }

      const [appResult, logsResult, envsResult, deploymentsResult] = await Promise.allSettled([
        coolifyGet<Record<string, unknown>>(`/applications/${uuid}`, undefined, instance),
        coolifyGet<string>(`/applications/${uuid}/logs`, { lines: log_lines }, instance),
        coolifyGet<Array<{ key: string; is_buildtime?: boolean; is_runtime?: boolean }>>(
          `/applications/${uuid}/envs`,
          undefined,
          instance
        ),
        coolifyGet<unknown>(`/applications/${uuid}/deployments`, undefined, instance),
      ]);

      const errors: string[] = [];
      function extract<T>(result: PromiseSettledResult<T>, label: string): T | null {
        if (result.status === "fulfilled") return result.value;
        errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        return null;
      }

      const app = extract(appResult, "application");
      const logs = extract(logsResult, "logs");
      const envs = extract(envsResult, "environment_variables");
      const deploymentsRaw = extract(deploymentsResult, "deployments");

      const deployments: Array<{ uuid: string; status: string; created_at: string }> =
        Array.isArray(deploymentsRaw)
          ? deploymentsRaw
          : (deploymentsRaw as { deployments?: unknown[] })?.deployments ?? [];

      // Health assessment
      const issues: string[] = [];
      let healthStatus = "unknown";
      const status = String(app?.["status"] ?? "");
      if (status) {
        if (status.includes("running") || status.includes("healthy")) {
          healthStatus = "healthy";
        } else if (status.includes("exited") || status.includes("unhealthy") || status.includes("error")) {
          healthStatus = "unhealthy";
          issues.push(`Status: ${status}`);
        } else {
          issues.push(`Status: ${status}`);
        }
      }
      const recentFailed = deployments.slice(0, 5).filter((d) => d.status === "failed");
      if (recentFailed.length > 0) {
        issues.push(`${recentFailed.length} failed deployment(s) in last 5`);
        if (healthStatus === "healthy") healthStatus = "unhealthy";
      }

      const output = {
        application: app
          ? {
              uuid: app["uuid"],
              name: app["name"],
              status: app["status"] ?? "unknown",
              fqdn: app["fqdn"] ?? null,
              git_repository: app["git_repository"] ?? null,
              git_branch: app["git_branch"] ?? null,
            }
          : null,
        health: { status: healthStatus, issues },
        logs: typeof logs === "string" ? logs : null,
        environment_variables: {
          count: envs?.length ?? 0,
          // Keys only — values intentionally omitted from diagnostics output
          keys: (envs ?? []).map((v) => ({
            key: v.key,
            is_buildtime: v.is_buildtime ?? false,
            is_runtime: v.is_runtime ?? true,
          })),
        },
        recent_deployments: deployments.slice(0, 5).map((d) => ({
          uuid: d.uuid,
          status: d.status,
          created_at: d.created_at,
        })),
        ...(errors.length > 0 && { errors }),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    }
  );

  // ── diagnose_server ───────────────────────────────────────────────────

  server.registerTool(
    "coolify_diagnose_server",
    {
      title: "Diagnose Server",
      description:
        "Composite diagnostic for a server: fetches details, resources, domains, and " +
        "runs a connectivity validation in parallel. Accepts UUID, name, or IP address.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Server UUID, name, or IP address"),
        instance: CoolifyInstanceSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, instance }: { query: string; instance: CoolifyInstance }) => {
      let uuid: string;
      try {
        uuid = await resolveServerUuid(query, instance);
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        };
      }

      const [serverResult, resourcesResult, domainsResult, validationResult] = await Promise.allSettled([
        coolifyGet<Record<string, unknown>>(`/servers/${uuid}`, undefined, instance),
        coolifyGet<Array<{ uuid: string; name: string; type: string; status: string }>>(
          `/servers/${uuid}/resources`,
          undefined,
          instance
        ),
        coolifyGet<Array<{ ip: string; domains: string[] }>>(
          `/servers/${uuid}/domains`,
          undefined,
          instance
        ),
        coolifyGet<{ message?: string; validation_logs?: string }>(
          `/servers/${uuid}/validate`,
          undefined,
          instance
        ),
      ]);

      const errors: string[] = [];
      function extract<T>(result: PromiseSettledResult<T>, label: string): T | null {
        if (result.status === "fulfilled") return result.value;
        errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        return null;
      }

      const server = extract(serverResult, "server");
      const resources = extract(resourcesResult, "resources");
      const domains = extract(domainsResult, "domains");
      const validation = extract(validationResult, "validation");

      const issues: string[] = [];
      let healthStatus = "unknown";
      if (server) {
        if (server["is_reachable"] === true) {
          healthStatus = "healthy";
        } else if (server["is_reachable"] === false) {
          healthStatus = "unhealthy";
          issues.push("Server is not reachable");
        }
        if (server["is_usable"] === false) {
          issues.push("Server is not usable");
          healthStatus = "unhealthy";
        }
      }
      const unhealthy = (resources ?? []).filter(
        (r) => r.status.includes("exited") || r.status.includes("unhealthy") || r.status.includes("error")
      );
      if (unhealthy.length > 0) issues.push(`${unhealthy.length} unhealthy resource(s)`);

      const output = {
        server: server
          ? {
              uuid: server["uuid"],
              name: server["name"],
              ip: server["ip"],
              status: server["status"] ?? null,
              is_reachable: server["is_reachable"] ?? null,
            }
          : null,
        health: { status: healthStatus, issues },
        resources: (resources ?? []).map((r) => ({
          uuid: r.uuid,
          name: r.name,
          type: r.type,
          status: r.status,
        })),
        domains: (domains ?? []).map((d) => ({ ip: d.ip, domains: d.domains })),
        validation: validation
          ? {
              message: validation.message,
              ...(validation.validation_logs && { validation_logs: validation.validation_logs }),
            }
          : null,
        ...(errors.length > 0 && { errors }),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    }
  );

  // ── find_issues ───────────────────────────────────────────────────────

  server.registerTool(
    "coolify_find_issues",
    {
      title: "Find Infrastructure Issues",
      description:
        "Scan all servers, applications, databases, and services for unhealthy or " +
        "unreachable resources. Returns a summary with counts and a detailed issues list.",
      inputSchema: {
        instance: CoolifyInstanceSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ instance }: { instance: CoolifyInstance }) => {
      const [serversResult, appsResult, dbsResult, svcsResult] = await Promise.allSettled([
        coolifyGet<Array<{ uuid: string; name: string; status?: string; is_reachable?: boolean }>>(
          "/servers",
          undefined,
          instance
        ),
        coolifyGet<Array<{ uuid: string; name: string; status?: string }>>(
          "/applications",
          undefined,
          instance
        ),
        coolifyGet<Array<{ uuid: string; name: string; status?: string }>>(
          "/databases",
          undefined,
          instance
        ),
        coolifyGet<Array<{ uuid: string; name: string; status?: string }>>(
          "/services",
          undefined,
          instance
        ),
      ]);

      const errors: string[] = [];
      function extract<T>(result: PromiseSettledResult<T>, label: string): T | null {
        if (result.status === "fulfilled") return result.value;
        errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        return null;
      }

      const servers = extract(serversResult, "servers");
      const apps = extract(appsResult, "applications");
      const dbs = extract(dbsResult, "databases");
      const svcs = extract(svcsResult, "services");

      const issues: Array<{ type: string; uuid: string; name: string; issue: string; status: string }> = [];

      const unhealthyStatus = (s: string) =>
        s.includes("exited") || s.includes("unhealthy") || s.includes("error") || s === "stopped";

      for (const server of servers ?? []) {
        if (server.is_reachable === false) {
          issues.push({
            type: "server",
            uuid: server.uuid,
            name: server.name,
            issue: "Server is not reachable",
            status: server.status ?? "unreachable",
          });
        }
      }
      for (const app of apps ?? []) {
        const s = app.status ?? "";
        if (unhealthyStatus(s)) {
          issues.push({ type: "application", uuid: app.uuid, name: app.name, issue: `Application status: ${s}`, status: s });
        }
      }
      for (const db of dbs ?? []) {
        const s = db.status ?? "";
        if (unhealthyStatus(s)) {
          issues.push({ type: "database", uuid: db.uuid, name: db.name, issue: `Database status: ${s}`, status: s });
        }
      }
      for (const svc of svcs ?? []) {
        const s = svc.status ?? "";
        if (unhealthyStatus(s)) {
          issues.push({ type: "service", uuid: svc.uuid, name: svc.name, issue: `Service status: ${s}`, status: s });
        }
      }

      const output = {
        summary: {
          total_issues: issues.length,
          unreachable_servers: issues.filter((i) => i.type === "server").length,
          unhealthy_applications: issues.filter((i) => i.type === "application").length,
          unhealthy_databases: issues.filter((i) => i.type === "database").length,
          unhealthy_services: issues.filter((i) => i.type === "service").length,
        },
        issues,
        ...(errors.length > 0 && { errors }),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    }
  );
}
