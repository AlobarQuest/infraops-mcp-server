// Loader for per-repo `.cred-consumers.toml` files — the WS-0.7 consumer inventory
// that gates rotation (a credential whose consumer set is not attested here is
// NEVER auto-revoked).
//
// STRICT SUBSET TOML parser, deliberately not a third-party dependency: this feeds
// the 4am no-LLM write path, so the parsing surface stays minimal and fully
// unit-tested. Supported syntax: comments/blank lines, `key = value` (string,
// integer, boolean, array-of-strings), [[credential]] and
// [[credential.consumer]] / [[credential.exposure]] tables. Anything else throws
// CredConsumersParseError — deny-by-default: a malformed file yields NO
// rotation-eligible credentials, never a guessed one.

import * as fs from "node:fs";

export class CredConsumersParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredConsumersParseError";
  }
}

export interface ConsumerSpec {
  kind: string;
  uuid?: string;
  service?: string;
  account?: string;
  instance?: string;
  resource_type?: string;
  key?: string;
  redeploy?: boolean;
  repo?: string;
  name?: string;
  file?: string;
  var?: string;
  note?: string;
}

export interface ExposureSpec {
  id: string;
  date: string;
  source?: string;
}

export interface CredentialSpec {
  id: string;
  class: string;
  fingerprint_sha256_8?: string;
  provider?: string;
  provider_identity?: string;
  bws_uuid?: string;
  consumers_verified?: string;
  verified_by?: string;
  disposition?: string;
  replacement_scope?: string;
  created?: string;
  last_rotated?: string;
  rotation_preconditions: string[];
  consumers: ConsumerSpec[];
  exposures: ExposureSpec[];
}

type Scalar = string | number | boolean | string[];

function parseValue(raw: string, line: number): Scalar {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    const inner = v.slice(1, -1);
    if (inner.includes('"')) throw new CredConsumersParseError(`line ${line}: embedded quote in string`);
    return inner;
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (v.startsWith("[") && v.endsWith("]")) {
    const body = v.slice(1, -1).trim();
    if (!body) return [];
    return body.split(",").map((part) => {
      const p = part.trim();
      if (!(p.startsWith('"') && p.endsWith('"') && p.length >= 2)) {
        throw new CredConsumersParseError(`line ${line}: arrays may contain only quoted strings`);
      }
      return p.slice(1, -1);
    });
  }
  throw new CredConsumersParseError(`line ${line}: unsupported value syntax: ${v.slice(0, 40)}`);
}

/**
 * Strip a trailing comment from a line, respecting quoted strings and arrays of
 * quoted strings (the only string-bearing forms the subset allows).
 */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inString = !inString;
    else if (ch === "#" && !inString) return line.slice(0, i);
  }
  return line;
}

/** Parse one .cred-consumers.toml document. Throws CredConsumersParseError on any deviation. */
export function parseCredConsumers(text: string): CredentialSpec[] {
  const creds: CredentialSpec[] = [];
  let cred: CredentialSpec | null = null;
  let sub: ConsumerSpec | ExposureSpec | null = null;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const line = stripComment(lines[i]).trim();
    if (!line) continue;

    if (line === "[[credential]]") {
      cred = { id: "", class: "", rotation_preconditions: [], consumers: [], exposures: [] };
      creds.push(cred);
      sub = null;
      continue;
    }
    if (line === "[[credential.consumer]]" || line === "[[credential.exposure]]") {
      if (!cred) throw new CredConsumersParseError(`line ${n}: ${line} before any [[credential]]`);
      if (line === "[[credential.consumer]]") {
        sub = { kind: "" } as ConsumerSpec;
        cred.consumers.push(sub as ConsumerSpec);
      } else {
        sub = { id: "", date: "" } as ExposureSpec;
        cred.exposures.push(sub as ExposureSpec);
      }
      continue;
    }
    if (line.startsWith("[")) throw new CredConsumersParseError(`line ${n}: unsupported table ${line}`);

    const eq = line.indexOf("=");
    if (eq < 1) throw new CredConsumersParseError(`line ${n}: expected key = value`);
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new CredConsumersParseError(`line ${n}: bad key ${key}`);
    const value = parseValue(line.slice(eq + 1), n);

    if (sub) {
      (sub as unknown as Record<string, Scalar>)[key] = value;
    } else if (cred) {
      (cred as unknown as Record<string, Scalar>)[key] = value;
    } else if (key === "version") {
      if (value !== 1) throw new CredConsumersParseError(`unsupported version ${String(value)}`);
    } else {
      throw new CredConsumersParseError(`line ${n}: top-level key ${key} outside any table`);
    }
  }

  for (const c of creds) {
    if (typeof c.id !== "string" || typeof c.class !== "string" || !c.id || !c.class) {
      throw new CredConsumersParseError(`credential missing string id/class (id=${String(c.id) || "?"})`);
    }
    for (const consumer of c.consumers) {
      if (!consumer.kind) throw new CredConsumersParseError(`credential ${c.id}: consumer missing kind`);
    }
    for (const exposure of c.exposures) {
      if (!exposure.id || !exposure.date) throw new CredConsumersParseError(`credential ${c.id}: exposure missing id/date`);
    }
  }
  const ids = new Set<string>();
  for (const c of creds) {
    if (ids.has(c.id)) throw new CredConsumersParseError(`duplicate credential id ${c.id}`);
    ids.add(c.id);
  }
  return creds;
}

/**
 * Load every listed .cred-consumers.toml. A missing list file or empty list means
 * NO managed credentials (deny-by-default) — rotation detection simply emits nothing.
 * A listed-but-unreadable/unparseable file throws (the caller escalates, never guesses).
 */
export function loadCredConsumerFiles(files: string[]): CredentialSpec[] {
  const all: CredentialSpec[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e) {
      throw new CredConsumersParseError(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const cred of parseCredConsumers(text)) {
      if (ids.has(cred.id)) throw new CredConsumersParseError(`duplicate credential id ${cred.id} across files (${file})`);
      ids.add(cred.id);
      all.push(cred);
    }
  }
  return all;
}
