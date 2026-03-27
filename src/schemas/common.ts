/**
 * Shared Zod schemas used across multiple tool files.
 */

import { z } from "zod";
import { ResponseFormat } from "../constants.js";

export const CoolifyInstanceSchema = z
  .enum(["prod", "dev"])
  .default("prod")
  .describe(
    "Coolify instance to target: 'prod' (Hetzner VPS) or 'dev' (local OrbStack VM). Defaults to prod."
  );

export const ResponseFormatSchema = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.JSON)
  .describe("Output format: 'json' for structured data or 'markdown' for human-readable");

export const UuidSchema = z
  .string()
  .min(1, "UUID is required")
  .describe("The UUID of the resource");

export const PaginationSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum results to return (1-100)"),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination"),
});
