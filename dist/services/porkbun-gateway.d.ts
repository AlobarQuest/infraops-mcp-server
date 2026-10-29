/**
 * Gateway to Porkbun's official MCP server, run as a child process.
 *
 * The child (@porkbunllc/mcp-server, pinned in package.json) starts on first use
 * and is reused for later calls. It gets only the two Porkbun keys in its
 * environment, never infraops' other provider tokens. If it exits, the next call
 * starts a fresh one; three failed starts within a minute pause starts for five
 * minutes. Its stderr is forwarded with a [porkbun] prefix; it never touches
 * infraops' stdout, which carries the MCP protocol.
 *
 * Environment variables:
 *   PORKBUN_API_KEY        - Porkbun API key
 *   PORKBUN_SECRET_API_KEY - Porkbun secret API key
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export interface PorkbunToolInfo {
    name: string;
    description: string;
    readOnly: boolean;
    inputSchema: unknown;
}
export interface PorkbunGatewayOptions {
    entryPath?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    now?: () => number;
}
export declare function isPorkbunConfigured(): boolean;
export declare class PorkbunGateway {
    private readonly entryPath?;
    private readonly env;
    private readonly timeoutMs;
    private readonly now;
    private session;
    private current;
    private failures;
    constructor(opts?: PorkbunGatewayOptions);
    listTools(): Promise<PorkbunToolInfo[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
    close(): Promise<void>;
    /** Synchronously signals the child; for process exit handlers, where close() can't finish. */
    kill(): void;
    private connect;
    private start;
    private retryAt;
}
/** Process-wide gateway; the first call registers handlers that stop the child on shutdown. */
export declare function getPorkbunGateway(): PorkbunGateway;
//# sourceMappingURL=porkbun-gateway.d.ts.map