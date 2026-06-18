/**
 * Pure secret redaction (Balanced posture). No I/O. Applied centrally by
 * register-sanitized.ts to every tool response. Masks to "***"; preserves null.
 */
export declare function isSecretName(key: string): boolean;
export declare function redactText(s: string): string;
export declare function deepRedact(value: unknown): unknown;
//# sourceMappingURL=redaction.d.ts.map