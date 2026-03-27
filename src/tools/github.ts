/**
 * GitHub tools — repo creation and deploy key management.
 *
 * These tools complement Coolify's private key tools to enable
 * fully automated private repo deployments:
 *   1. coolify_create_private_key → generates key, stores in Coolify
 *   2. github_add_deploy_key → adds public key to GitHub repo
 *   3. coolify_create_application_deploykey → creates app linked to key
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  githubGet,
  githubPost,
  githubDelete,
  handleGithubError,
} from "../services/github-client.js";

const RepoSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/,
    "Must be in owner/name format (e.g. 'AlobarQuest/my-app')"
  )
  .describe("Repository in owner/name format (e.g. 'AlobarQuest/my-app')");

const OrgSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]+$/, "Must be a valid GitHub org/user name")
  .optional()
  .describe("Organization name (omit for personal repo under authenticated user)");

interface GitHubRepo {
  id: number;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  private: boolean;
  default_branch: string;
}

interface GitHubDeployKey {
  id: number;
  key: string;
  url: string;
  title: string;
  verified: boolean;
  created_at: string;
  read_only: boolean;
}

export function registerGithubTools(server: McpServer): void {
  // ── Create Repository ─────────────────────────────────────────────

  server.registerTool(
    "github_create_repo",
    {
      title: "Create GitHub Repository",
      description:
        "Create a new GitHub repository under the authenticated user or an organization. " +
        "Defaults to private. Returns the repo URL, clone URL, and SSH URL.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("Repository name (e.g. 'my-new-app')"),
        org: OrgSchema,
        private: z
          .boolean()
          .default(true)
          .describe("Whether the repo is private (default: true)"),
        description: z
          .string()
          .optional()
          .describe("Repository description"),
        auto_init: z
          .boolean()
          .default(false)
          .describe("Create initial commit with README (default: false)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      name: string;
      org?: string;
      private: boolean;
      description?: string;
      auto_init: boolean;
    }) => {
      try {
        const body: Record<string, unknown> = {
          name: params.name,
          private: params.private,
          auto_init: params.auto_init,
        };
        if (params.description) body.description = params.description;

        const endpoint = params.org
          ? `/orgs/${params.org}/repos`
          : "/user/repos";

        const repo = await githubPost<GitHubRepo>(endpoint, body);
        return {
          content: [{ type: "text", text: JSON.stringify(repo, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleGithubError(error) }],
        };
      }
    }
  );

  // ── Add Deploy Key ────────────────────────────────────────────────

  server.registerTool(
    "github_add_deploy_key",
    {
      title: "Add GitHub Deploy Key",
      description:
        "Add an SSH public key as a deploy key to a GitHub repository. " +
        "Use this after coolify_create_private_key to link the generated public key to the repo. " +
        "Note: each SSH key can only be a deploy key on ONE repo across all of GitHub.",
      inputSchema: {
        repo: RepoSchema,
        title: z
          .string()
          .min(1)
          .describe("Deploy key label (e.g. 'coolify-deploy')"),
        key: z
          .string()
          .min(1)
          .describe("SSH public key (e.g. 'ssh-ed25519 AAAA...')"),
        read_only: z
          .boolean()
          .default(true)
          .describe("Read-only access (default: true — principle of least privilege)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      repo: string;
      title: string;
      key: string;
      read_only: boolean;
    }) => {
      try {
        const deployKey = await githubPost<GitHubDeployKey>(
          `/repos/${params.repo}/keys`,
          {
            title: params.title,
            key: params.key,
            read_only: params.read_only,
          }
        );
        return {
          content: [
            { type: "text", text: JSON.stringify(deployKey, null, 2) },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleGithubError(error) }],
        };
      }
    }
  );

  // ── List Deploy Keys ──────────────────────────────────────────────

  server.registerTool(
    "github_list_deploy_keys",
    {
      title: "List GitHub Deploy Keys",
      description:
        "List all deploy keys for a GitHub repository. Returns key ID, title, fingerprint, and read_only status.",
      inputSchema: {
        repo: RepoSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ repo }: { repo: string }) => {
      try {
        const keys = await githubGet<GitHubDeployKey[]>(
          `/repos/${repo}/keys`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(keys, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleGithubError(error) }],
        };
      }
    }
  );

  // ── Remove Deploy Key ─────────────────────────────────────────────

  server.registerTool(
    "github_remove_deploy_key",
    {
      title: "Remove GitHub Deploy Key",
      description:
        "Remove a deploy key from a GitHub repository by key ID. " +
        "Get the key_id from github_list_deploy_keys.",
      inputSchema: {
        repo: RepoSchema,
        key_id: z
          .number()
          .int()
          .describe("Deploy key ID to remove"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ repo, key_id }: { repo: string; key_id: number }) => {
      try {
        await githubDelete(`/repos/${repo}/keys/${key_id}`);
        return {
          content: [
            {
              type: "text",
              text: `Deploy key ${key_id} removed from ${repo}.`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleGithubError(error) }],
        };
      }
    }
  );
}
