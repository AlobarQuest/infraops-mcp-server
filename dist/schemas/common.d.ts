/**
 * Shared Zod schemas used across multiple tool files.
 */
import { z } from "zod";
import { ResponseFormat } from "../constants.js";
export declare const CoolifyInstanceSchema: z.ZodDefault<z.ZodEnum<["prod", "dev"]>>;
/**
 * Required (no-default) instance selector for *mutating* Coolify tools.
 *
 * Read tools use {@link CoolifyInstanceSchema} (defaults to "prod" for convenience).
 * Any tool that changes state (readOnlyHint: false) must use THIS schema instead:
 * with no `.default()`, Zod makes `instance` required, so a bare call is rejected at
 * the tool boundary before it can silently land a write on prod. See the
 * "Mutating coolify_* tools require an explicit instance" invariant in CLAUDE.md.
 */
export declare const CoolifyInstanceRequiredSchema: z.ZodEnum<["prod", "dev"]>;
export declare const ResponseFormatSchema: z.ZodDefault<z.ZodNativeEnum<typeof ResponseFormat>>;
export declare const UuidSchema: z.ZodString;
export declare const PaginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    offset: number;
}, {
    limit?: number | undefined;
    offset?: number | undefined;
}>;
//# sourceMappingURL=common.d.ts.map