/**
 * Coolify API client — multi-instance support.
 *
 * Supports multiple Coolify instances (e.g. "prod" and "dev") via
 * environment variables. Every public helper accepts an optional
 * `instance` parameter that defaults to "prod".
 *
 * Env vars:
 *   COOLIFY_PROD_BASE_URL / COOLIFY_PROD_API_TOKEN  (or legacy COOLIFY_BASE_URL / COOLIFY_API_TOKEN)
 *   COOLIFY_DEV_BASE_URL  / COOLIFY_DEV_API_TOKEN   (optional)
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { REQUEST_TIMEOUT } from '../constants.js';

// ── Types ────────────────────────────────────────────────────────────

export type CoolifyInstance = 'prod' | 'dev';

// ── Configuration ────────────────────────────────────────────────────

interface InstanceConfig {
  baseUrl: string;
  token: string;
}

function getInstanceConfig(instance: CoolifyInstance): InstanceConfig {
  const upper = instance.toUpperCase(); // "PROD" | "DEV"

  // Try prefixed vars first, fall back to legacy unprefixed for prod
  const baseUrl =
    process.env[`COOLIFY_${upper}_BASE_URL`] ??
    (instance === 'prod' ? process.env.COOLIFY_BASE_URL : undefined);

  const token =
    process.env[`COOLIFY_${upper}_API_TOKEN`] ??
    (instance === 'prod' ? process.env.COOLIFY_API_TOKEN : undefined);

  if (!baseUrl) {
    throw new Error(
      `COOLIFY_${upper}_BASE_URL environment variable is required. ` +
        `Set it to your ${instance} Coolify instance URL.`,
    );
  }
  if (!token) {
    throw new Error(
      `COOLIFY_${upper}_API_TOKEN environment variable is required. ` +
        `Generate a Bearer token in the ${instance} Coolify UI → Settings → API Tokens.`,
    );
  }

  // Normalise: strip trailing slash, ensure /api/v1 suffix
  let url = baseUrl.replace(/\/+$/, '');
  if (!url.endsWith('/api/v1')) {
    url = url.replace(/\/api\/?$/, '') + '/api/v1';
  }

  return { baseUrl: url, token };
}

// ── Instance clients ─────────────────────────────────────────────────

const _clients = new Map<CoolifyInstance, AxiosInstance>();

function getClient(instance: CoolifyInstance = 'prod'): AxiosInstance {
  const existing = _clients.get(instance);
  if (existing) return existing;

  const { baseUrl, token } = getInstanceConfig(instance);

  const client = axios.create({
    baseURL: baseUrl,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  _clients.set(instance, client);
  return client;
}

// ── Configuration checks ─────────────────────────────────────────────

export function isCoolifyInstanceConfigured(instance: CoolifyInstance): boolean {
  const upper = instance.toUpperCase();
  const baseUrl =
    process.env[`COOLIFY_${upper}_BASE_URL`] ??
    (instance === 'prod' ? process.env.COOLIFY_BASE_URL : undefined);
  const token =
    process.env[`COOLIFY_${upper}_API_TOKEN`] ??
    (instance === 'prod' ? process.env.COOLIFY_API_TOKEN : undefined);
  return !!(baseUrl && token);
}

export function getConfiguredInstances(): CoolifyInstance[] {
  const instances: CoolifyInstance[] = [];
  if (isCoolifyInstanceConfigured('prod')) instances.push('prod');
  if (isCoolifyInstanceConfigured('dev')) instances.push('dev');
  return instances;
}

export function getCoolifyInstanceUrl(instance: CoolifyInstance): string | undefined {
  const upper = instance.toUpperCase();
  return (
    process.env[`COOLIFY_${upper}_BASE_URL`] ??
    (instance === 'prod' ? process.env.COOLIFY_BASE_URL : undefined)
  );
}

// ── Public helpers ───────────────────────────────────────────────────

export async function coolifyGet<T>(
  endpoint: string,
  params?: Record<string, unknown>,
  instance: CoolifyInstance = 'prod',
): Promise<T> {
  const client = getClient(instance);
  const response = await client.get<T>(endpoint, { params });
  return response.data;
}

export async function coolifyPost<T>(
  endpoint: string,
  data?: Record<string, unknown>,
  instance: CoolifyInstance = 'prod',
): Promise<T> {
  const client = getClient(instance);
  const response = await client.post<T>(endpoint, data);
  return response.data;
}

export async function coolifyPatch<T>(
  endpoint: string,
  data?: Record<string, unknown>,
  instance: CoolifyInstance = 'prod',
): Promise<T> {
  const client = getClient(instance);
  const response = await client.patch<T>(endpoint, data);
  return response.data;
}

export async function coolifyDelete<T>(
  endpoint: string,
  instance: CoolifyInstance = 'prod',
): Promise<T> {
  const client = getClient(instance);
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
      const msg = typeof body === 'object' && body?.message ? body.message : JSON.stringify(body);

      switch (status) {
        case 401:
          return (
            'Error: Authentication failed. Your COOLIFY_API_TOKEN may be invalid or expired. ' +
            'Regenerate it in Coolify UI → Settings → API Tokens.'
          );
        case 403:
          return 'Error: Permission denied. Your API token may lack the required scope for this operation.';
        case 404:
          return `Error: Resource not found. Check that the UUID/ID is correct. API said: ${msg}`;
        case 422:
          return `Error: Validation failed. ${msg}`;
        case 429:
          return 'Error: Rate limit exceeded. Wait a moment before retrying.';
        case 500:
          return `Error: Coolify server error (500). This is usually transient — retry in a few seconds. Details: ${msg}`;
        default:
          return `Error: Coolify API returned HTTP ${status}. Details: ${msg}`;
      }
    }

    if (axErr.code === 'ECONNABORTED') {
      return 'Error: Request timed out. Check that your Coolify instance is reachable.';
    }
    if (axErr.code === 'ECONNREFUSED') {
      return 'Error: Connection refused. Verify COOLIFY_BASE_URL is correct and the instance is running.';
    }
  }

  return `Error: Unexpected error — ${error instanceof Error ? error.message : String(error)}`;
}
