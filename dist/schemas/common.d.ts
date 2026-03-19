/**
 * Shared Zod schemas used across multiple tool files.
 */
import { z } from "zod";
import { ResponseFormat } from "../constants.js";
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