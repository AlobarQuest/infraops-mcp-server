/**
 * Pure secret redaction (Balanced posture). No I/O. Applied centrally by
 * register-sanitized.ts to every tool response. Masks to "***"; preserves null.
 */

const MASK = '***';

// Field names whose VALUE is a secret. Checked only after the guard below.
// Deliberate omission: `api_key` / `key` field NAMES are NOT listed here — their
// secret VALUES (JWTs, PEMs, prefixed tokens) are caught by VALUE_SHAPES instead,
// avoiding over-masking of benign `*_key` fields (e.g. cache_key, sort_key).
const SECRET_NAME =
  /(password|secret|token|credentials|private_key|service_role|jwt_secret|tunnel_secret)/i;

// Names that look secret-ish but are not — never redact by name (value-shape may still apply).
const GUARD_NAME =
  /(?:^|_)(id|uuid|name|fingerprint|url|at|count|type|status|version|region|host|port)$|^public_key$|_key_name$|^key_name$/i;

export function isSecretName(key: string): boolean {
  if (GUARD_NAME.test(key)) return false;
  return SECRET_NAME.test(key);
}

// Value shapes redacted regardless of field name.
const VALUE_SHAPES: RegExp[] = [
  // PEM private key — to matching END or end-of-string (truncation-safe).
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|$)/g,
  // JWT (starts eyJ — base64 of `{"`). Catches Supabase anon/service_role keys.
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // GitHub tokens.
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // OpenAI / Anthropic.
  /\bsk-(?:ant-)?[A-Za-z0-9-]{20,}\b/g,
];

// Connection-string password: keep scheme/user/host, mask the password segment only.
const CONN_PW = /\b([a-z][a-z0-9+.-]*:\/\/[^:@/\s]+:)([^@/\s]+)(@)/gi;

export function redactText(s: string): string {
  let out = s;
  for (const re of VALUE_SHAPES) out = out.replace(re, MASK);
  out = out.replace(CONN_PW, `$1${MASK}$3`);
  return out;
}

export function deepRedact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null && v !== undefined && isSecretName(k)) out[k] = MASK;
      else out[k] = deepRedact(v);
    }
    return out;
  }
  return value;
}
