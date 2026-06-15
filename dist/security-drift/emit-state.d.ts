export declare class EmitStateIntegrityError extends Error {
    constructor(message: string);
}
export interface EmitStateEntry {
    hash: string;
    ts: string;
}
export type EmitState = Record<string, EmitStateEntry>;
/** Load + validate. Missing file → {} (no recorded hashes; executor will block, which is safe). */
export declare function loadEmitState(file: string): EmitState;
/** Atomic write with mode 0600. */
export declare function saveEmitState(file: string, state: EmitState): void;
/** Drop entries older than maxAgeDays relative to `now` (ISO). */
export declare function pruneEmitState(state: EmitState, maxAgeDays: number, now: string): EmitState;
//# sourceMappingURL=emit-state.d.ts.map