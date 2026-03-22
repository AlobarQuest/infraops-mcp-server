/**
 * Supabase Management API client.
 *
 * Wraps the Supabase Management API at https://api.supabase.com/v1.
 * Used for project lifecycle, database queries, Edge Functions,
 * secrets, auth config, and storage bucket management.
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import { REQUEST_TIMEOUT } from "../constants.js";

const SUPABASE_API_BASE = "https://api.supabase.com/v1";

// ── Singleton client ─────────────────────────────────────────────────

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (_client) return _client;

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN environment variable is required. " +
        "Generate a Personal Access Token at https://supabase.com/dashboard/account/tokens. " +
        "Store it in BWS and set BWS_SUPABASE_SECRET_ID in your MCP config."
    );
  }

  _client = axios.create({
    baseURL: SUPABASE_API_BASE,
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

export async function supabaseGet<T>(
  endpoint: string,
  params?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.get<T>(endpoint, { params });
  return response.data;
}

export async function supabasePost<T>(
  endpoint: string,
  data?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.post<T>(endpoint, data);
  return response.data;
}

export async function supabasePut<T>(
  endpoint: string,
  data?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.put<T>(endpoint, data);
  return response.data;
}

export async function supabasePatch<T>(
  endpoint: string,
  data?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.patch<T>(endpoint, data);
  return response.data;
}

export async function supabaseDelete<T>(
  endpoint: string,
  data?: Record<string, unknown>
): Promise<T> {
  const client = getClient();
  const response = await client.delete<T>(endpoint, { data });
  return response.data;
}

// ── Error handler ────────────────────────────────────────────────────

export function handleSupabaseError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError<{ message?: string; error?: string }>;

    if (axErr.response) {
      const status = axErr.response.status;
      const body = axErr.response.data;
      const msg = body?.message ?? body?.error ?? JSON.stringify(body);

      switch (status) {
        case 401:
          return (
            "Error: Supabase authentication failed. Your SUPABASE_ACCESS_TOKEN may be invalid or expired. " +
            "Regenerate it at https://supabase.com/dashboard/account/tokens."
          );
        case 403:
          return `Error: Supabase permission denied. ${msg}`;
        case 404:
          return `Error: Supabase resource not found. ${msg}`;
        case 422:
          return `Error: Supabase validation failed. ${msg}`;
        case 429:
          return "Error: Supabase rate limit exceeded. Wait before retrying.";
        default:
          return `Error: Supabase API returned HTTP ${status}. ${msg}`;
      }
    }

    if (axErr.code === "ECONNABORTED") {
      return "Error: Supabase API request timed out.";
    }
  }

  return `Error: Unexpected Supabase error — ${error instanceof Error ? error.message : String(error)}`;
}

/** Check if Supabase Management API is configured */
export function isSupabaseConfigured(): boolean {
  return !!process.env.SUPABASE_ACCESS_TOKEN;
}
