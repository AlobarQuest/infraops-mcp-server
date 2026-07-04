import axios, { AxiosInstance } from 'axios';
import { REQUEST_TIMEOUT } from '../constants.js';

/** A resolved app-brain environment. github_repo/branch/url may be null per the contract;
 *  the handoff builder treats a null/empty repo OR branch as UNCONFIRMED. */
export interface AppResolution {
  github_repo: string | null;
  name: string;
  branch: string | null;
  url: string | null;
}

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (_client) return _client;

  const baseURL = process.env.APPBRAIN_BASE_URL;
  const key = process.env.APPBRAIN_ACCESS_KEY;
  if (!baseURL || !key) {
    throw new Error('app-brain is not configured. Set APPBRAIN_BASE_URL and APPBRAIN_ACCESS_KEY.');
  }

  // Config hardening: this client ships a secret-bearing x-brain-key, so refuse to send it
  // over cleartext or to a credential-spoofed host (panel MED-4).
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error(`APPBRAIN_BASE_URL is not a valid URL: ${baseURL}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`APPBRAIN_BASE_URL must be https — refusing to send x-brain-key in cleartext.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('APPBRAIN_BASE_URL must not contain credentials.');
  }

  _client = axios.create({
    baseURL,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-brain-key': key,
    },
  });
  return _client;
}

const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** Type-validate the 200 body. Throws on a malformed shape (treated as a resolver error upstream,
 *  never confirmed). github_repo/branch/url may legitimately be null — that is incomplete, not
 *  malformed, and is resolved to UNCONFIRMED by the handoff builder. */
export function validateResolution(body: unknown): AppResolution {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new Error('app-brain resolve: body is not an object');
  if (typeof b.name !== 'string' || b.name.trim() === '')
    throw new Error('app-brain resolve: name missing/empty');
  if (!strOrNull(b.github_repo))
    throw new Error('app-brain resolve: github_repo must be string or null');
  if (!strOrNull(b.branch)) throw new Error('app-brain resolve: branch must be string or null');
  if (!strOrNull(b.url)) throw new Error('app-brain resolve: url must be string or null');
  return {
    github_repo: (b.github_repo as string | null) ?? null,
    name: b.name,
    branch: (b.branch as string | null) ?? null,
    url: (b.url as string | null) ?? null,
  };
}

/** Resolve a Coolify app to its repo+branch. 200 → validated body; 404 → null; anything else throws. */
export async function resolveApp(args: {
  coolifyAppUuid: string;
  fqdn: string | null;
}): Promise<AppResolution | null> {
  const client = getClient();
  const params: Record<string, string> = { coolify_app_uuid: args.coolifyAppUuid };
  if (args.fqdn) params.fqdn = args.fqdn;
  const res = await client.get('/api/apps/resolve', {
    params,
    validateStatus: (s) => s === 200 || s === 404,
  });
  if (res.status === 404) return null;
  return validateResolution(res.data);
}

export function isAppbrainConfigured(): boolean {
  return !!(process.env.APPBRAIN_BASE_URL && process.env.APPBRAIN_ACCESS_KEY);
}
