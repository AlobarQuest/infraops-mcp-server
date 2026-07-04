// The shared 0600/owner-validated JSON store backing every security-drift trust
// boundary (accepted baseline, emit-state plan hashes, cred-rotation state).
//
// SECURITY: these files are attacker targets — a writable store lets an adversary
// suppress a finding, forge an "accepted" state, or pass a tampered plan through the
// 4am integrity gate. So every read validates regular-file + mode 0600 + owner, and
// every write is atomic (tmp + rename) at mode 0600. Callers supply their own error
// constructor so existing error types (BaselineIntegrityError, …) stay stable.

import * as fs from 'node:fs';
import * as path from 'node:path';

type IntegrityErrorCtor = new (message: string) => Error;

/**
 * Load + validate a 0600 JSON store. Missing file → null (caller decides whether
 * that means "seed" or "empty"). Any validation failure throws the caller's error.
 */
export function loadValidated0600Json<T>(
  file: string,
  label: string,
  ErrorCtor: IntegrityErrorCtor,
): T | null {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw e;
  }
  if (!st.isFile()) throw new ErrorCtor(`${label} ${file} is not a regular file`);
  if ((st.mode & 0o777) !== 0o600)
    throw new ErrorCtor(`${label} ${file} mode is ${(st.mode & 0o777).toString(8)}, expected 600`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new ErrorCtor(`${label} ${file} owned by uid ${st.uid}, expected ${process.getuid()}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/** Atomic write with mode 0600. */
export function saveValidated0600Json(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}
