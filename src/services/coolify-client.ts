/**
 * Coolify API client.
 *
 * Centralises all HTTP communication with the Coolify REST API.
 * Every tool delegates to this client — no tool should import axios directly.
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import { REQUEST_TIMEOUT } from "../constants.js";

// ── Configuration ────────────────────────────────────────────────────

function getConfig(): { baseUrl: string; token: string } {
  const baseUrl = process.env.COOLIFY_BASE_URL;
  const token = process.env.COOLIFY_API_TOKEN;

  if (!baseUrl) {
    throw new Error(
      "COOLIFY_BASE_URL environment variable is required. " +
        "Set it to your Coolify instance URL, e.g. https://coolify.devonwatkins.com"
    );
  }
  if (!token) {
    throw new Error(
      "COOLIFY_API_TOKEN environment variable is required. " +
        "Generate a Bearer token in Coolify UI → Settings → API Tokens."
    );
  }

  // Normalise: strip trailing slash, ensure /api/v1 suffix
  let url = baseUrl.replace(/\/+$/, "");
  if (!url.endsWith("/api/v1")) {
    url = url.replace(/\/api\/?$/, "") + "/api/v1";
  }

  return { baseUrl: url, token };
}

// ── Singleton client ─────────────────────────────────────────────────

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (_client) return _client;

  const { baseUrl, token } = getConfig();

  _client = axios.create({
    baseURL: baseUrl,
    timeout: REQUEST_TIMEOUT,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  return _client;
}

// ── Public helpers ───────────────────────────────────────────────────

export async function coolifyGet<T>(
  endpoint: string,
  params?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.get<T>(endpoint, { params });
  return response.data;
}

export async function coolifyPost<T>(
  endpoint: string,
  data?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.post<T>(endpoint, data);
  return response.data;
}

export async function coolifyPatch<T>(
  endpoint: string,
  data?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.patch<T>(endpoint, data);
  return response.data;
}

export async function coolifyDelete<T>(endpoint: string): Promise<T> {
  const client = getClient();
  const response = await client.delete<T>(endpoint);
  return response.data;
}

// ── Error handler ────────────────────────────────────────────────────

export function handleCoolifyError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError<{ message?: string }>;

    if (axErr.response) {
      const status = axErr.response.status;
      const body = axErr.response.data;
      const msg =
        typeof body === "object" && body?.message
          ? body.message
          : JSON.stringify(body);

      switch (status) {
        case 401:
          return (
            "Error: Authentication failed. Your COOLIFY_API_TOKEN may be invalid or expired. " +
            "Regenerate it in Coolify UI → Settings → API Tokens."
          );
        case 403:
          return (
            "Error: Permission denied. Your API token may lack the required scope for this operation."
          );
        case 404:
          return `Error: Resource not found. Check that the UUID/ID is correct. API said: ${msg}`;
        case 422:
          return `Error: Validation failed. ${msg}`;
        case 429:
          return "Error: Rate limit exceeded. Wait a moment before retrying.";
        case 500:
          return `Error: Coolify server error (500). This is usually transient — retry in a few seconds. Details: ${msg}`;
        default:
          return `Error: Coolify API returned HTTP ${status}. Details: ${msg}`;
      }
    }

    if (axErr.code === "ECONNABORTED") {
      return "Error: Request timed out. Check that your Coolify instance is reachable.";
    }
    if (axErr.code === "ECONNREFUSED") {
      return (
        "Error: Connection refused. Verify COOLIFY_BASE_URL is correct and the instance is running."
      );
    }
  }

  return `Error: Unexpected error — ${error instanceof Error ? error.message : String(error)}`;
}
