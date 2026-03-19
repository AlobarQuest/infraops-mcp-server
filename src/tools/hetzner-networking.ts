/**
 * Hetzner Cloud networking tools — Firewalls, SSH Keys, Floating IPs, Networks.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  hetznerGet,
  hetznerPost,
  hetznerPut,
  hetznerDelete,
  handleHetznerError,
} from "../services/hetzner-client.js";

export function registerHetznerNetworkingTools(server: McpServer): void {
  // ═══════════════════════════════════════════════════════════════════
  //  FIREWALLS
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "hetzner_list_firewalls",
    {
      title: "List Hetzner Firewalls",
      description: "List all firewalls in the project with their rules and applied resources.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await hetznerGet<Record<string, unknown>>("/firewalls");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_get_firewall",
    {
      title: "Get Hetzner Firewall",
      description: "Get full details for a firewall by ID — rules, applied resources, labels.",
      inputSchema: { id: z.number().int().describe("Firewall ID") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }: { id: number }) => {
      try {
        const result = await hetznerGet<Record<string, unknown>>(`/firewalls/${id}`);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_create_firewall",
    {
      title: "Create Hetzner Firewall",
      description:
        "Create a new firewall with rules. Rules specify direction (in/out), protocol, port, and source/destination IPs.",
      inputSchema: {
        name: z.string().min(1).describe("Firewall name"),
        rules: z
          .array(
            z.object({
              direction: z.enum(["in", "out"]).describe("Traffic direction"),
              protocol: z.enum(["tcp", "udp", "icmp", "esp", "gre"]).describe("Protocol"),
              port: z.string().optional().describe("Port or range (e.g. '22', '80-443')"),
              source_ips: z.array(z.string()).optional().describe("Source CIDRs for inbound rules"),
              destination_ips: z.array(z.string()).optional().describe("Destination CIDRs for outbound rules"),
              description: z.string().optional().describe("Rule description"),
            })
          )
          .optional()
          .describe("Firewall rules"),
        apply_to: z
          .array(
            z.object({
              type: z.enum(["server", "label_selector"]).describe("Apply type"),
              server: z.object({ id: z.number().int() }).optional(),
              label_selector: z.object({ selector: z.string() }).optional(),
            })
          )
          .optional()
          .describe("Resources to apply the firewall to"),
        labels: z.record(z.string()).optional().describe("Labels"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: Record<string, unknown>) => {
      try {
        const body: Record<string, unknown> = { name: params.name };
        if (params.rules) body.rules = params.rules;
        if (params.apply_to) body.apply_to = params.apply_to;
        if (params.labels) body.labels = params.labels;
        const result = await hetznerPost<Record<string, unknown>>("/firewalls", body);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_update_firewall_rules",
    {
      title: "Update Hetzner Firewall Rules",
      description: "Replace all rules on a firewall. This is a full replacement — include all desired rules.",
      inputSchema: {
        id: z.number().int().describe("Firewall ID"),
        rules: z
          .array(
            z.object({
              direction: z.enum(["in", "out"]),
              protocol: z.enum(["tcp", "udp", "icmp", "esp", "gre"]),
              port: z.string().optional(),
              source_ips: z.array(z.string()).optional(),
              destination_ips: z.array(z.string()).optional(),
              description: z.string().optional(),
            })
          )
          .describe("Complete set of firewall rules"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, rules }: { id: number; rules: unknown[] }) => {
      try {
        const result = await hetznerPost<Record<string, unknown>>(
          `/firewalls/${id}/actions/set_rules`,
          { rules }
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_delete_firewall",
    {
      title: "Delete Hetzner Firewall",
      description: "Delete a firewall. It must not be applied to any resources.",
      inputSchema: { id: z.number().int().describe("Firewall ID") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }: { id: number }) => {
      try {
        await hetznerDelete(`/firewalls/${id}`);
        return { content: [{ type: "text", text: `Firewall ${id} deleted.` }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  SSH KEYS
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "hetzner_list_ssh_keys",
    {
      title: "List Hetzner SSH Keys",
      description: "List all SSH keys registered in the Hetzner project.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await hetznerGet<Record<string, unknown>>("/ssh_keys");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_create_ssh_key",
    {
      title: "Create Hetzner SSH Key",
      description: "Register a new SSH public key in Hetzner. Can then be used when creating servers.",
      inputSchema: {
        name: z.string().min(1).describe("Key name"),
        public_key: z.string().min(1).describe("SSH public key content (e.g. ssh-ed25519 AAAA...)"),
        labels: z.record(z.string()).optional().describe("Labels"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: { name: string; public_key: string; labels?: Record<string, string> }) => {
      try {
        const body: Record<string, unknown> = { name: params.name, public_key: params.public_key };
        if (params.labels) body.labels = params.labels;
        const result = await hetznerPost<Record<string, unknown>>("/ssh_keys", body);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_delete_ssh_key",
    {
      title: "Delete Hetzner SSH Key",
      description: "Remove an SSH key from the Hetzner project.",
      inputSchema: { id: z.number().int().describe("SSH key ID") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }: { id: number }) => {
      try {
        await hetznerDelete(`/ssh_keys/${id}`);
        return { content: [{ type: "text", text: `SSH key ${id} deleted.` }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  VOLUMES
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "hetzner_list_volumes",
    {
      title: "List Hetzner Volumes",
      description: "List all block storage volumes.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await hetznerGet<Record<string, unknown>>("/volumes");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_create_volume",
    {
      title: "Create Hetzner Volume",
      description: "Create a new block storage volume and optionally attach it to a server.",
      inputSchema: {
        name: z.string().min(1).describe("Volume name"),
        size: z.number().int().min(10).describe("Size in GB (minimum 10)"),
        location: z.string().optional().describe("Location (e.g. fsn1). Required if not attaching to server."),
        server: z.number().int().optional().describe("Server ID to attach to"),
        format: z.enum(["ext4", "xfs"]).optional().describe("Filesystem format"),
        labels: z.record(z.string()).optional().describe("Labels"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: Record<string, unknown>) => {
      try {
        const body: Record<string, unknown> = { name: params.name, size: params.size };
        for (const k of ["location", "server", "format", "labels"]) {
          if (params[k] !== undefined) body[k] = params[k];
        }
        const result = await hetznerPost<Record<string, unknown>>("/volumes", body);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_resize_volume",
    {
      title: "Resize Hetzner Volume",
      description: "Increase a volume's size. Cannot shrink — only grow.",
      inputSchema: {
        id: z.number().int().describe("Volume ID"),
        size: z.number().int().describe("New size in GB (must be larger than current)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, size }: { id: number; size: number }) => {
      try {
        const result = await hetznerPost<Record<string, unknown>>(
          `/volumes/${id}/actions/resize`,
          { size }
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_delete_volume",
    {
      title: "Delete Hetzner Volume",
      description: "Delete a volume. Must be detached from all servers first.",
      inputSchema: { id: z.number().int().describe("Volume ID") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }: { id: number }) => {
      try {
        await hetznerDelete(`/volumes/${id}`);
        return { content: [{ type: "text", text: `Volume ${id} deleted.` }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  SNAPSHOTS / IMAGES
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "hetzner_list_images",
    {
      title: "List Hetzner Images",
      description:
        "List images — includes OS images, snapshots, and backups. Filter by type for just snapshots.",
      inputSchema: {
        type: z
          .enum(["system", "snapshot", "backup"])
          .optional()
          .describe("Filter by image type"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ type }: { type?: string }) => {
      try {
        const params: Record<string, unknown> = {};
        if (type) params.type = type;
        const result = await hetznerGet<Record<string, unknown>>("/images", params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_create_snapshot",
    {
      title: "Create Hetzner Server Snapshot",
      description:
        "Create a snapshot of a server. The server will be briefly stopped during the snapshot.",
      inputSchema: {
        id: z.number().int().describe("Server ID to snapshot"),
        description: z.string().optional().describe("Snapshot description"),
        labels: z.record(z.string()).optional().describe("Labels"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: { id: number; description?: string; labels?: Record<string, string> }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.description) body.description = params.description;
        if (params.labels) body.labels = params.labels;
        const result = await hetznerPost<Record<string, unknown>>(
          `/servers/${params.id}/actions/create_image`,
          { ...body, type: "snapshot" }
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_delete_image",
    {
      title: "Delete Hetzner Image/Snapshot",
      description: "Delete a snapshot or backup image. Cannot delete system images.",
      inputSchema: { id: z.number().int().describe("Image/snapshot ID") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }: { id: number }) => {
      try {
        await hetznerDelete(`/images/${id}`);
        return { content: [{ type: "text", text: `Image ${id} deleted.` }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  NETWORKS
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "hetzner_list_networks",
    {
      title: "List Hetzner Networks",
      description: "List all private networks.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await hetznerGet<Record<string, unknown>>("/networks");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  FLOATING IPs
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "hetzner_list_floating_ips",
    {
      title: "List Hetzner Floating IPs",
      description: "List all floating IPs with their assignments.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await hetznerGet<Record<string, unknown>>("/floating_ips");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  //  PRICING & SERVER TYPES (reference data)
  // ═══════════════════════════════════════════════════════════════════

  server.registerTool(
    "hetzner_list_server_types",
    {
      title: "List Hetzner Server Types",
      description:
        "List all available server types with pricing, specs (CPU, RAM, disk), and availability by datacenter. " +
        "Useful when deciding which server type to upgrade or create.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await hetznerGet<Record<string, unknown>>("/server_types");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );

  server.registerTool(
    "hetzner_list_datacenters",
    {
      title: "List Hetzner Datacenters",
      description: "List all available datacenters and locations.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const result = await hetznerGet<Record<string, unknown>>("/datacenters");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: handleHetznerError(error) }] };
      }
    }
  );
}
