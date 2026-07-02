type IntegrityErrorCtor = new (message: string) => Error;
/**
 * Load + validate a 0600 JSON store. Missing file → null (caller decides whether
 * that means "seed" or "empty"). Any validation failure throws the caller's error.
 */
export declare function loadValidated0600Json<T>(file: string, label: string, ErrorCtor: IntegrityErrorCtor): T | null;
/** Atomic write with mode 0600. */
export declare function saveValidated0600Json(file: string, data: unknown): void;
export {};
//# sourceMappingURL=validated-store.d.ts.map