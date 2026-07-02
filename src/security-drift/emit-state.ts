// The emit-state store: fingerprint → recorded plan-hash at emit time.
//
// SECURITY (trust boundary): this anchors the 4am integrity check in a Mac-side
// 0600/owner-validated file. If an attacker could rewrite it, they could make a
// tampered approved plan pass the gate — so it is validated on read exactly like the
// baseline. It is a MERGE store (entries persist across runs, pruned by age) so an
// item approved on a later day can still be verified against the hash recorded when
// it was emitted.

import { loadValidated0600Json, saveValidated0600Json } from "./validated-store.js";

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
  return loadValidated0600Json<EmitState>(file, "emit-state", EmitStateIntegrityError) ?? {};
}

/** Atomic write with mode 0600. */
export function saveEmitState(file: string, state: EmitState): void {
  saveValidated0600Json(file, state);
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
