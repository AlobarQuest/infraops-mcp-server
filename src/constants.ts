/**
 * Shared constants for the InfraOps MCP Server.
 */

/** Maximum response size in characters to prevent overwhelming LLM context */
export const CHARACTER_LIMIT = 25000;

/** Default pagination limit */
export const DEFAULT_LIMIT = 20;

/** API request timeout in milliseconds */
export const REQUEST_TIMEOUT = 30000;

/** Response format options */
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}
