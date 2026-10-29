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

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { Readable, type Stream } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { REQUEST_TIMEOUT } from '../constants.js';

const ENTRY_SPECIFIER = '@porkbunllc/mcp-server/dist/index.js';
const FAILURE_LIMIT = 3;
const FAILURE_WINDOW_MS = 60_000;
const BACKOFF_MS = 300_000;

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

interface Session {
  client: Client;
  transport: StdioClientTransport;
  tools?: PorkbunToolInfo[];
}

export function isPorkbunConfigured(): boolean {
  return !!(process.env.PORKBUN_API_KEY && process.env.PORKBUN_SECRET_API_KEY);
}

// The package has no main/exports, so resolve the stdio entry file directly.
function defaultEntryPath(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve(ENTRY_SPECIFIER);
  } catch {
    return undefined;
  }
}

function forwardStderr(stream: Stream | null): void {
  if (!(stream instanceof Readable)) return;
  createInterface({ input: stream }).on('line', (line) => {
    process.stderr.write(`[porkbun] ${line}\n`);
  });
}

export class PorkbunGateway {
  private readonly entryPath?: string;
  private readonly env: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private session: Promise<Session> | null = null;
  private current: Session | null = null;
  private failures: number[] = [];

  constructor(opts: PorkbunGatewayOptions = {}) {
    this.entryPath = opts.entryPath;
    this.env = opts.env ?? {
      PORKBUN_API_KEY: process.env.PORKBUN_API_KEY ?? '',
      PORKBUN_SECRET_API_KEY: process.env.PORKBUN_SECRET_API_KEY ?? '',
    };
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT;
    this.now = opts.now ?? Date.now;
  }

  async listTools(): Promise<PorkbunToolInfo[]> {
    const session = await this.connect();
    if (!session.tools) {
      const { tools } = await session.client.listTools(undefined, { timeout: this.timeoutMs });
      session.tools = tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        readOnly: t.annotations?.readOnlyHint === true,
        inputSchema: t.inputSchema,
      }));
    }
    return session.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const session = await this.connect();
    return (await session.client.callTool({ name, arguments: args }, undefined, {
      timeout: this.timeoutMs,
    })) as CallToolResult;
  }

  async close(): Promise<void> {
    const pending = this.session;
    this.session = null;
    this.current = null;
    const session = await pending?.catch(() => null);
    await session?.client.close();
  }

  /** Synchronously signals the child; for process exit handlers, where close() can't finish. */
  kill(): void {
    const pid = this.current?.transport.pid;
    if (!pid) return;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }

  // Concurrent first calls share one start-up.
  private connect(): Promise<Session> {
    if (!this.session) {
      const starting = this.start();
      this.session = starting;
      starting.catch(() => {
        if (this.session === starting) this.session = null;
      });
    }
    return this.session;
  }

  private async start(): Promise<Session> {
    const retryAt = this.retryAt();
    if (retryAt !== null) {
      throw new Error(
        `Porkbun MCP server failed to start ${FAILURE_LIMIT} times within a minute; ` +
          `retry after ${new Date(retryAt).toISOString()}`,
      );
    }

    let transport: StdioClientTransport | undefined;
    try {
      const entry = this.entryPath ?? defaultEntryPath();
      if (!entry || !existsSync(entry)) {
        throw new Error(
          `Porkbun MCP server not found at ${entry ?? ENTRY_SPECIFIER}; ` +
            'run `npm ci` in the infraops checkout',
        );
      }

      // StdioClientTransport merges only HOME, LOGNAME, PATH, SHELL, TERM and USER under env.
      transport = new StdioClientTransport({
        command: process.execPath,
        args: [entry],
        env: this.env,
        stderr: 'pipe',
      });
      forwardStderr(transport.stderr);

      const client = new Client({ name: 'infraops-porkbun-gateway', version: '1.0.0' });
      const session: Session = { client, transport };
      // Set before connect() so Client chains its own handler after this one: by the time
      // an in-flight call rejects on a child exit, the next call already starts fresh.
      transport.onclose = () => {
        if (this.current !== session) return;
        this.current = null;
        this.session = null;
      };
      this.current = session;
      await client.connect(transport, { timeout: this.timeoutMs });
      this.failures = [];
      return session;
    } catch (err) {
      this.failures = [...this.failures, this.now()].slice(-FAILURE_LIMIT);
      if (transport && this.current?.transport === transport) this.current = null;
      await transport?.close().catch(() => {});
      throw err;
    }
  }

  private retryAt(): number | null {
    if (this.failures.length < FAILURE_LIMIT) return null;
    const first = this.failures[0];
    const last = this.failures[FAILURE_LIMIT - 1];
    if (last - first > FAILURE_WINDOW_MS) return null;
    const until = last + BACKOFF_MS;
    return this.now() < until ? until : null;
  }
}

let gateway: PorkbunGateway | null = null;

/** Process-wide gateway; the first call registers handlers that stop the child on shutdown. */
export function getPorkbunGateway(): PorkbunGateway {
  if (!gateway) {
    const gw = new PorkbunGateway();
    gateway = gw;
    // A live child keeps the event loop alive, so without this infraops would no
    // longer exit when its client closes stdin.
    process.stdin.once('end', () => void gw.close().catch(() => {}));
    process.once('exit', () => gw.kill());
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      // once() has already removed this listener, so re-raising gets Node's default exit.
      process.once(signal, () => {
        gw.kill();
        process.kill(process.pid, signal);
      });
    }
  }
  return gateway;
}
