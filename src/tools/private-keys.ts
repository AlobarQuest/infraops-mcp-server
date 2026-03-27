/**
 * Private key management tools for Coolify.
 *
 * Manages SSH private keys via /security/keys API.
 * Keys are used for Git deploy key authentication and server access.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import ssh2 from "ssh2";
const { utils } = ssh2;
import {
  coolifyGet,
  coolifyPost,
  coolifyDelete,
  handleCoolifyError,
} from "../services/coolify-client.js";
import { UuidSchema, CoolifyInstanceSchema } from "../schemas/common.js";
import type { CoolifyInstance } from "../services/coolify-client.js";
import type { CoolifyPrivateKey } from "../types.js";

export function registerPrivateKeyTools(server: McpServer): void {
  // ── List Private Keys ─────────────────────────────────────────────

  server.registerTool(
    "coolify_list_private_keys",
    {
      title: "List Coolify Private Keys",
      description:
        "List all SSH private keys stored in Coolify. These are used for Git deploy key authentication " +
        "and server SSH access. Returns UUID, name, description, and fingerprint for each key.",
      inputSchema: { instance: CoolifyInstanceSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ instance }: { instance: CoolifyInstance }) => {
      try {
        const keys = await coolifyGet<CoolifyPrivateKey[]>(
          "/security/keys",
          undefined,
          instance
        );
        // Strip private key material from list response
        const safeKeys = keys.map(({ private_key: _omit, ...rest }) => rest);
        return {
          content: [{ type: "text", text: JSON.stringify(safeKeys, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Create Private Key ────────────────────────────────────────────

  server.registerTool(
    "coolify_create_private_key",
    {
      title: "Create Coolify Private Key",
      description:
        "Generate an Ed25519 SSH key pair and store it in Coolify. Returns the UUID and public key. " +
        "The public key should be added to GitHub as a deploy key (via github_add_deploy_key) " +
        "or to a server's authorized_keys. The private key is stored encrypted in Coolify.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("Display name for the key (e.g. 'my-app-deploy')"),
        description: z
          .string()
          .optional()
          .describe("Optional description of what this key is used for"),
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      name,
      description,
      instance,
    }: {
      name: string;
      description?: string;
      instance: CoolifyInstance;
    }) => {
      try {
        // Generate Ed25519 key pair using ssh2 (already a dependency)
        const keyPair = utils.generateKeyPairSync("ed25519", {
          comment: name,
        });

        const body: Record<string, unknown> = {
          private_key: keyPair.private,
          name,
        };
        if (description) body.description = description;

        const key = await coolifyPost<CoolifyPrivateKey>(
          "/security/keys",
          body,
          instance
        );

        // Strip private key material, return public key for GitHub
        const { private_key: _omit, ...safeKey } = key;
        const result = {
          ...safeKey,
          public_key: keyPair.public,
          _note:
            "Add the public_key to GitHub as a deploy key using github_add_deploy_key, " +
            "then use the uuid as private_key_uuid when creating an application with coolify_create_application_deploykey.",
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );

  // ── Delete Private Key ────────────────────────────────────────────

  server.registerTool(
    "coolify_delete_private_key",
    {
      title: "Delete Coolify Private Key",
      description:
        "Delete an SSH private key from Coolify by UUID. " +
        "Will fail with 422 if the key is still in use by an application or server.",
      inputSchema: {
        uuid: UuidSchema,
        instance: CoolifyInstanceSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ uuid, instance }: { uuid: string; instance: CoolifyInstance }) => {
      try {
        await coolifyDelete(`/security/keys/${uuid}`, instance);
        return {
          content: [
            {
              type: "text",
              text: `Private key ${uuid} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleCoolifyError(error) }],
        };
      }
    }
  );
}
