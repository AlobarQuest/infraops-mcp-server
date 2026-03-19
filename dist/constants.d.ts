/**
 * Shared constants for the InfraOps MCP Server.
 */
/** Maximum response size in characters to prevent overwhelming LLM context */
export declare const CHARACTER_LIMIT = 25000;
/** Default pagination limit */
export declare const DEFAULT_LIMIT = 20;
/** API request timeout in milliseconds */
export declare const REQUEST_TIMEOUT = 30000;
/** Response format options */
export declare enum ResponseFormat {
    MARKDOWN = "markdown",
    JSON = "json"
}
//# sourceMappingURL=constants.d.ts.map