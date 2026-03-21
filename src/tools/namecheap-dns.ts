/**
 * Namecheap DNS management tools.
 *
 * Provides DNS record CRUD for domains managed via Namecheap.
 *
 * IMPORTANT: Namecheap's setHosts API is a full-replace operation.
 * To add/update/delete a single record, we always:
 *   1. getHosts (fetch current records)
 *   2. Modify the array in memory
 *   3. setHosts (push entire set back)
 *
 * Tools exposed:
 *   namecheap_dns_get_hosts     - List all DNS records for a domain
 *   namecheap_dns_get_servers   - Get nameservers for a domain
 *   namecheap_dns_add_record    - Add a single DNS record (preserves existing)
 *   namecheap_dns_update_record - Update a DNS record by matching name+type
 *   namecheap_dns_delete_record - Delete a DNS record by matching name+type+address
 *   namecheap_dns_set_hosts     - Full replace of all DNS records (advanced)
 *   namecheap_dns_set_nameservers - Set custom nameservers
 *   namecheap_dns_set_default   - Reset to Namecheap default DNS
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  namecheapCommand,
  handleNamecheapError,
  splitDomain,
  type NamecheapHostRecord,
} from "../services/namecheap-client.js";

// ── Helpers ──────────────────────────────────────────────────────────

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "MXE", "TXT", "NS", "URL", "URL301", "FRAME"] as const;

type RecordType = typeof RECORD_TYPES[number];

interface HostEntry {
  Name: string;
  Type: string;
  Address: string;
  MXPref: number;
  TTL: number;
}

/**
 * Fetch current host records for a domain.
 */
async function fetchHosts(domain: string): Promise<HostEntry[]> {
  const { sld, tld } = splitDomain(domain);
  const result = await namecheapCommand("namecheap.domains.dns.getHosts", {
    SLD: sld,
    TLD: tld,
  });

  const hostResult = result.CommandResponse?.DomainDNSGetHostsResult as Record<string, unknown> | undefined;
  if (!hostResult) return [];

  const rawHosts = (hostResult as Record<string, unknown>).host;
  if (!rawHosts) return [];

  const hostArray = Array.isArray(rawHosts) ? rawHosts : [rawHosts];

  return hostArray.map((h: Record<string, unknown>) => ({
    Name: String(h.Name ?? h.HostName ?? ""),
    Type: String(h.Type ?? ""),
    Address: String(h.Address ?? ""),
    MXPref: Number(h.MXPref ?? 10),
    TTL: Number(h.TTL ?? 1800),
  }));
}

/**
 * Push a full set of host records to Namecheap.
 * This REPLACES all existing records.
 */
async function pushHosts(domain: string, hosts: HostEntry[]): Promise<Record<string, unknown>> {
  const { sld, tld } = splitDomain(domain);

  const params: Record<string, string | number | boolean> = {
    SLD: sld,
    TLD: tld,
  };

  hosts.forEach((h, i) => {
    const n = i + 1;
    params[`HostName${n}`] = h.Name;
    params[`RecordType${n}`] = h.Type;
    params[`Address${n}`] = h.Address;
    params[`MXPref${n}`] = h.MXPref;
    params[`TTL${n}`] = h.TTL;
  });

  const result = await namecheapCommand("namecheap.domains.dns.setHosts", params);
  return result.CommandResponse as Record<string, unknown>;
}

// ── Tool Registration ────────────────────────────────────────────────

export function registerNamecheapDNSTools(server: McpServer): void {

  // ═══════════════════════════════════════════════════════════════════
  //  GET HOSTS — List all DNS records
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "namecheap_dns_get_hosts",
    {
      title: "Get DNS Records",
      description:
        "List all DNS host records for a domain. Returns record name, type, address, TTL, and MX preference.",
      inputSchema: {
        domain: z.string().min(3).describe("Domain name (e.g. 'devonwatkins.com')"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ domain }: { domain: string }) => {
      try {
        const hosts = await fetchHosts(domain);
        const summary = {
          domain,
          recordCount: hosts.length,
          records: hosts.map((h) => ({
            name: h.Name,
            type: h.Type,
            address: h.Address,
            ttl: h.TTL,
            mxPref: h.Type === "MX" || h.Type === "MXE" ? h.MXPref : undefined,
          })),
        };
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleNamecheapError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  GET NAMESERVERS
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "namecheap_dns_get_servers",
    {
      title: "Get Nameservers",
      description:
        "Get the nameservers configured for a domain. Shows whether it uses Namecheap default DNS or custom nameservers.",
      inputSchema: {
        domain: z.string().min(3).describe("Domain name (e.g. 'devonwatkins.com')"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ domain }: { domain: string }) => {
      try {
        const { sld, tld } = splitDomain(domain);
        const result = await namecheapCommand("namecheap.domains.dns.getList", {
          SLD: sld,
          TLD: tld,
        });
        return { content: [{ type: "text", text: JSON.stringify(result.CommandResponse, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleNamecheapError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  ADD RECORD — Safe single-record addition
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "namecheap_dns_add_record",
    {
      title: "Add DNS Record",
      description:
        "Add a single DNS record to a domain while preserving all existing records. " +
        "Fetches current records, appends the new one, and pushes the full set back.",
      inputSchema: {
        domain: z.string().min(3).describe("Domain name (e.g. 'devonwatkins.com')"),
        name: z.string().describe("Host name (e.g. '@' for root, 'www', 'api', '*' for wildcard)"),
        type: z.enum(RECORD_TYPES).describe("Record type"),
        address: z.string().describe("Record value (IP address, hostname, or text content)"),
        ttl: z.number().int().min(60).max(86400).default(1800).describe("TTL in seconds (default: 1800)"),
        mxPref: z.number().int().min(0).max(65535).default(10).describe("MX priority (only for MX/MXE records)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: { domain: string; name: string; type: RecordType; address: string; ttl: number; mxPref: number }) => {
      try {
        const existingHosts = await fetchHosts(params.domain);

        const newRecord: HostEntry = {
          Name: params.name,
          Type: params.type,
          Address: params.address,
          MXPref: params.mxPref,
          TTL: params.ttl,
        };

        const allHosts = [...existingHosts, newRecord];
        const result = await pushHosts(params.domain, allHosts);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              domain: params.domain,
              added: { name: params.name, type: params.type, address: params.address },
              totalRecords: allHosts.length,
              response: result,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleNamecheapError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  UPDATE RECORD — Modify existing record by name+type match
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "namecheap_dns_update_record",
    {
      title: "Update DNS Record",
      description:
        "Update an existing DNS record matched by name and type. " +
        "If multiple records match, updates the first one. " +
        "Preserves all other records.",
      inputSchema: {
        domain: z.string().min(3).describe("Domain name (e.g. 'devonwatkins.com')"),
        name: z.string().describe("Host name to match (e.g. '@', 'www', 'api')"),
        type: z.enum(RECORD_TYPES).describe("Record type to match"),
        newAddress: z.string().optional().describe("New record value (IP, hostname, or text)"),
        newTtl: z.number().int().min(60).max(86400).optional().describe("New TTL in seconds"),
        newMxPref: z.number().int().min(0).max(65535).optional().describe("New MX priority"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: {
      domain: string;
      name: string;
      type: RecordType;
      newAddress?: string;
      newTtl?: number;
      newMxPref?: number;
    }) => {
      try {
        const hosts = await fetchHosts(params.domain);

        const idx = hosts.findIndex(
          (h) => h.Name.toLowerCase() === params.name.toLowerCase() && h.Type.toUpperCase() === params.type
        );

        if (idx === -1) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: No ${params.type} record found with name "${params.name}" on ${params.domain}`,
            }],
          };
        }

        const original = { ...hosts[idx] };
        if (params.newAddress !== undefined) hosts[idx].Address = params.newAddress;
        if (params.newTtl !== undefined) hosts[idx].TTL = params.newTtl;
        if (params.newMxPref !== undefined) hosts[idx].MXPref = params.newMxPref;

        const result = await pushHosts(params.domain, hosts);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              domain: params.domain,
              updated: {
                name: params.name,
                type: params.type,
                before: original,
                after: hosts[idx],
              },
              response: result,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleNamecheapError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  DELETE RECORD — Remove by name+type+address
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "namecheap_dns_delete_record",
    {
      title: "Delete DNS Record",
      description:
        "Delete a DNS record matched by name, type, and optionally address. " +
        "If address is omitted, removes ALL records matching name+type. " +
        "Preserves all other records.",
      inputSchema: {
        domain: z.string().min(3).describe("Domain name (e.g. 'devonwatkins.com')"),
        name: z.string().describe("Host name to match (e.g. '@', 'www', 'api')"),
        type: z.enum(RECORD_TYPES).describe("Record type to match"),
        address: z.string().optional().describe("Specific address to match. Omit to delete all records of this name+type."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: { domain: string; name: string; type: RecordType; address?: string }) => {
      try {
        const hosts = await fetchHosts(params.domain);
        const before = hosts.length;

        const filtered = hosts.filter((h) => {
          const nameMatch = h.Name.toLowerCase() === params.name.toLowerCase();
          const typeMatch = h.Type.toUpperCase() === params.type;
          const addrMatch = params.address ? h.Address.toLowerCase() === params.address.toLowerCase() : true;
          // Keep records that DON'T match all criteria
          return !(nameMatch && typeMatch && addrMatch);
        });

        const removed = before - filtered.length;
        if (removed === 0) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: `Error: No matching ${params.type} record "${params.name}" found on ${params.domain}`,
            }],
          };
        }

        const result = await pushHosts(params.domain, filtered);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              domain: params.domain,
              deleted: { name: params.name, type: params.type, address: params.address ?? "(all)" },
              recordsRemoved: removed,
              recordsRemaining: filtered.length,
              response: result,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleNamecheapError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  SET HOSTS — Full replace (advanced)
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "namecheap_dns_set_hosts",
    {
      title: "Set All DNS Records (Replace)",
      description:
        "ADVANCED: Replace ALL DNS records for a domain with the provided set. " +
        "⚠️ This removes any records not in the provided list. " +
        "For safe single-record operations, use add/update/delete tools instead.",
      inputSchema: {
        domain: z.string().min(3).describe("Domain name (e.g. 'devonwatkins.com')"),
        records: z
          .array(
            z.object({
              name: z.string().describe("Host name (e.g. '@', 'www', 'api')"),
              type: z.enum(RECORD_TYPES).describe("Record type"),
              address: z.string().describe("Record value"),
              ttl: z.number().int().min(60).max(86400).default(1800).describe("TTL in seconds"),
              mxPref: z.number().int().min(0).max(65535).default(10).describe("MX priority"),
            })
          )
          .min(1)
          .describe("Complete set of DNS records to apply"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: {
      domain: string;
      records: Array<{ name: string; type: RecordType; address: string; ttl: number; mxPref: number }>;
    }) => {
      try {
        const hosts: HostEntry[] = params.records.map((r) => ({
          Name: r.name,
          Type: r.type,
          Address: r.address,
          MXPref: r.mxPref,
          TTL: r.ttl,
        }));

        const result = await pushHosts(params.domain, hosts);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              domain: params.domain,
              recordsSet: hosts.length,
              response: result,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleNamecheapError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  SET CUSTOM NAMESERVERS
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "namecheap_dns_set_nameservers",
    {
      title: "Set Custom Nameservers",
      description:
        "Set custom nameservers for a domain (e.g. to use Cloudflare or another DNS provider). " +
        "⚠️ This will override Namecheap's DNS — existing host records via Namecheap will stop resolving.",
      inputSchema: {
        domain: z.string().min(3).describe("Domain name"),
        nameservers: z.array(z.string()).min(2).max(12).describe("Nameserver hostnames (e.g. ['ns1.cloudflare.com', 'ns2.cloudflare.com'])"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: { domain: string; nameservers: string[] }) => {
      try {
        const { sld, tld } = splitDomain(params.domain);
        const commandParams: Record<string, string | number | boolean> = {
          SLD: sld,
          TLD: tld,
          Nameservers: params.nameservers.join(","),
        };
        const result = await namecheapCommand("namecheap.domains.dns.setCustom", commandParams);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              domain: params.domain,
              nameservers: params.nameservers,
              response: result.CommandResponse,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleNamecheapError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  SET DEFAULT DNS
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "namecheap_dns_set_default",
    {
      title: "Reset to Default DNS",
      description: "Reset a domain to use Namecheap's default nameservers.",
      inputSchema: {
        domain: z.string().min(3).describe("Domain name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ domain }: { domain: string }) => {
      try {
        const { sld, tld } = splitDomain(domain);
        const result = await namecheapCommand("namecheap.domains.dns.setDefault", {
          SLD: sld,
          TLD: tld,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              domain,
              message: "Domain reset to Namecheap default nameservers",
              response: result.CommandResponse,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleNamecheapError(error) }] };
      }
    }
  );
}
