/**
 * GitHub REST API client.
 *
 * Provides deploy key management and repo creation via the GitHub API.
 * Requires a GITHUB_TOKEN env var (classic PAT with `repo` scope).
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import { REQUEST_TIMEOUT } from "../constants.js";

const GITHUB_API_BASE = "https://api.github.com";

// ── Singleton client ─────────────────────────────────────────────────

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (_client) return _client;

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN environment variable is required. " +
        "Create a PAT with `repo` scope at https://github.com/settings/tokens. " +
        "Store it in BWS and set BWS_GITHUB_SECRET_ID in your MCP config."
    );
  }

  _client = axios.create({
    baseURL: GITHUB_API_BASE,
    timeout: REQUEST_TIMEOUT,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  return _client;
}

// ── Public helpers ───────────────────────────────────────────────────

export async function githubGet<T>(
  endpoint: string,
  params?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.get<T>(endpoint, { params });
  return response.data;
}

export async function githubPost<T>(
  endpoint: string,
  data?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.post<T>(endpoint, data);
  return response.data;
}

export async function githubDelete<T>(endpoint: string): Promise<T> {
  const client = getClient();
  const response = await client.delete<T>(endpoint);
  return response.data;
}

// ── Error handler ────────────────────────────────────────────────────

export function handleGithubError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError<{ message?: string; errors?: Array<{ message?: string }> }>;

    if (axErr.response) {
      const status = axErr.response.status;
      const body = axErr.response.data;
      const msg = body?.message ?? JSON.stringify(body);
      const details = body?.errors?.map((e) => e.message).join("; ");
      const full = details ? `${msg} — ${details}` : msg;

      switch (status) {
        case 401:
          return (
            "Error: GitHub authentication failed. Your GITHUB_TOKEN may be invalid or expired. " +
            "Regenerate it at https://github.com/settings/tokens."
          );
        case 403:
          return `Error: GitHub permission denied. Your token may lack the required scope. ${full}`;
        case 404:
          return `Error: GitHub resource not found. Check that the repo/key ID exists. ${full}`;
        case 422:
          return `Error: GitHub validation failed. ${full}`;
        case 429:
          return "Error: GitHub rate limit exceeded. Wait before retrying.";
        default:
          return `Error: GitHub API returned HTTP ${status}. ${full}`;
      }
    }

    if (axErr.code === "ECONNABORTED") {
      return "Error: GitHub API request timed out.";
    }
  }

  return `Error: Unexpected GitHub error — ${error instanceof Error ? error.message : String(error)}`;
}

/** Check if GitHub API is configured */
export function isGithubConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}
