// The emit-state store: fingerprint → recorded plan-hash at emit time.
//
// SECURITY (trust boundary): this anchors the 4am integrity check in a Mac-side
// 0600/owner-validated file. If an attacker could rewrite it, they could make a
// tampered approved plan pass the gate — so it is validated on read exactly like the
// baseline. It is a MERGE store (entries persist across runs, pruned by age) so an
// item approved on a later day can still be verified against the hash recorded when
// it was emitted.

import * as fs from "node:fs";
import * as path from "node:path";

export class EmitStateIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmitStateIntegrityError";
  }
}

export interface EmitStateEntry {
  hash: string;
  ts: string;
}
export type EmitState = Record<string, EmitStateEntry>; // key = fingerprint

/** Load + validate. Missing file → {} (no recorded hashes; executor will block, which is safe). */
export function loadEmitState(file: string): EmitState {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch (e: any) {
    if (e?.code === "ENOENT") return {};
    throw e;
  }
  if (!st.isFile()) throw new EmitStateIntegrityError(`emit-state ${file} is not a regular file`);
  if ((st.mode & 0o777) !== 0o600) throw new EmitStateIntegrityError(`emit-state ${file} mode is ${(st.mode & 0o777).toString(8)}, expected 600`);
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
    throw new EmitStateIntegrityError(`emit-state ${file} owned by uid ${st.uid}, expected ${process.getuid()}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as EmitState;
}

/** Atomic write with mode 0600. */
export function saveEmitState(file: string, state: EmitState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

/** Drop entries older than maxAgeDays relative to `now` (ISO). */
export function pruneEmitState(state: EmitState, maxAgeDays: number, now: string): EmitState {
  const cutoff = new Date(now).getTime() - maxAgeDays * 86400_000;
  const out: EmitState = {};
  for (const [k, v] of Object.entries(state)) {
    if (new Date(v.ts).getTime() >= cutoff) out[k] = v;
  }
  return out;
}
