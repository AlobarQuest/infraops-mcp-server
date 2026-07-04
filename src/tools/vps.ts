/**
 * VPS operations tools — shell, health, file, and Docker operations on a chosen VPS.
 *
 * Every tool accepts an `instance` parameter:
 *   - "prod" (default) → Hetzner VPS via SSH (existing path, unchanged).
 *   - "dev"            → OrbStack `ubuntu` machine via `orb run` (no user SSH setup required).
 *
 * Callers already use `coolify_*({instance: "dev"})` to query the dev Coolify; these tools
 * must mirror that routing so follow-up VPS introspection lands on the same host. Leaving
 * instance unspecified preserves existing prod behavior for every pre-existing caller.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  vpsExec,
  vpsReadFile,
  vpsWriteFile,
  dockerCmdPrefix,
  handleVpsError,
  type VpsInstance,
} from '../services/vps-dispatch.js';

const instanceSchema = z
  .enum(['prod', 'dev'])
  .default('prod')
  .describe(
    "Which VPS to target: 'prod' (Hetzner at 178.156.247.239 via SSH) or 'dev' " +
      "(local OrbStack machine via `orb run`). Defaults to 'prod'. Must match the Coolify " +
      'instance when debugging Coolify-managed containers — mismatched routing silently hits the wrong host.',
  );

export function registerVPSTools(server: McpServer): void {
  // ── Execute Command ──────────────────────────────────────────────

  server.registerTool(
    'vps_exec',
    {
      title: 'Execute VPS Command',
      description:
        'Run a shell command on the selected VPS and return stdout, stderr, and exit code. ' +
        "Targets Hetzner prod by default; pass instance='dev' to run inside the OrbStack ubuntu machine. " +
        'Use for any ad-hoc operation: checking processes, installing packages, inspecting logs, etc.',
      inputSchema: {
        instance: instanceSchema,
        command: z.string().min(1).describe('Shell command to execute on the selected VPS'),
        timeout: z
          .number()
          .int()
          .min(5000)
          .max(300000)
          .default(30000)
          .describe('Timeout in milliseconds (default: 30000, max: 300000)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      instance,
      command,
      timeout,
    }: {
      instance: VpsInstance;
      command: string;
      timeout: number;
    }) => {
      try {
        const result = await vpsExec(instance, command, {
          timeout,
          allowFailure: true,
        });
        const output = [
          `Instance: ${instance}`,
          `Exit code: ${result.exitCode}`,
          result.stdout ? `\n--- stdout ---\n${result.stdout}` : '',
          result.stderr ? `\n--- stderr ---\n${result.stderr}` : '',
        ].join('');

        return {
          content: [{ type: 'text', text: output }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleVpsError(instance, error) }],
        };
      }
    },
  );

  // ── VPS Health ───────────────────────────────────────────────────

  server.registerTool(
    'vps_health',
    {
      title: 'VPS Health Check',
      description:
        'Get a comprehensive health snapshot of the selected VPS: uptime, CPU load, memory usage, ' +
        'disk usage, running Docker containers count, and top processes by CPU. ' +
        "Targets Hetzner prod by default; pass instance='dev' for the OrbStack ubuntu machine.",
      inputSchema: {
        instance: instanceSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ instance }: { instance: VpsInstance }) => {
      try {
        const docker = dockerCmdPrefix(instance);
        const healthCommand = [
          "echo '=== UPTIME ==='",
          'uptime',
          "echo ''",
          "echo '=== MEMORY ==='",
          'free -h',
          "echo ''",
          "echo '=== DISK ==='",
          'df -h / /var/lib/docker 2>/dev/null || df -h /',
          "echo ''",
          "echo '=== CPU LOAD ==='",
          'cat /proc/loadavg',
          "echo ''",
          "echo '=== DOCKER CONTAINERS ==='",
          `${docker} ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo 'Docker not available'`,
          "echo ''",
          "echo '=== TOP PROCESSES (CPU) ==='",
          'ps aux --sort=-%cpu | head -10',
        ].join(' && ');

        const result = await vpsExec(instance, healthCommand, { timeout: 15000 });
        return {
          content: [{ type: 'text', text: result.stdout }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleVpsError(instance, error) }],
        };
      }
    },
  );

  // ── Read File ────────────────────────────────────────────────────

  server.registerTool(
    'vps_read_file',
    {
      title: 'Read VPS File',
      description:
        'Read the contents of a file on the selected VPS. ' +
        "Targets Hetzner prod by default; pass instance='dev' for the OrbStack ubuntu machine.",
      inputSchema: {
        instance: instanceSchema,
        path: z.string().min(1).describe('Absolute path to the file on the VPS'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ instance, path }: { instance: VpsInstance; path: string }) => {
      try {
        const content = await vpsReadFile(instance, path);
        return {
          content: [{ type: 'text', text: content }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleVpsError(instance, error) }],
        };
      }
    },
  );

  // ── Write File ───────────────────────────────────────────────────

  server.registerTool(
    'vps_write_file',
    {
      title: 'Write VPS File',
      description:
        "Write content to a file on the selected VPS. Creates the file if it doesn't exist, overwrites if it does. " +
        "Targets Hetzner prod by default; pass instance='dev' for the OrbStack ubuntu machine.",
      inputSchema: {
        instance: instanceSchema,
        path: z.string().min(1).describe('Absolute path for the file on the VPS'),
        content: z.string().describe('Content to write'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      instance,
      path,
      content,
    }: {
      instance: VpsInstance;
      path: string;
      content: string;
    }) => {
      try {
        await vpsWriteFile(instance, path, content);
        return {
          content: [{ type: 'text', text: `File written to ${instance}: ${path}` }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleVpsError(instance, error) }],
        };
      }
    },
  );

  // ── Docker PS ────────────────────────────────────────────────────

  server.registerTool(
    'vps_docker_ps',
    {
      title: 'List Docker Containers',
      description:
        'List running Docker containers on the selected VPS. Shows name, image, status, ports, and size. ' +
        "Targets Hetzner prod by default; pass instance='dev' for the OrbStack ubuntu machine " +
        '(docker is invoked via sudo on dev).',
      inputSchema: {
        instance: instanceSchema,
        all: z.boolean().default(false).describe('Include stopped containers (default: false)'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ instance, all }: { instance: VpsInstance; all: boolean }) => {
      try {
        const docker = dockerCmdPrefix(instance);
        const flag = all ? ' -a' : '';
        const result = await vpsExec(
          instance,
          `${docker} ps${flag} --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Size}}'`,
          { timeout: 15000 },
        );
        return {
          content: [{ type: 'text', text: result.stdout }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleVpsError(instance, error) }],
        };
      }
    },
  );

  // ── Docker Logs ──────────────────────────────────────────────────

  server.registerTool(
    'vps_docker_logs',
    {
      title: 'Get Docker Container Logs',
      description:
        'Retrieve logs from a Docker container on the selected VPS. ' +
        "Targets Hetzner prod by default; pass instance='dev' for the OrbStack ubuntu machine.",
      inputSchema: {
        instance: instanceSchema,
        container: z.string().min(1).describe('Container name or ID'),
        lines: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe('Number of log lines to tail (default: 100)'),
        since: z
          .string()
          .optional()
          .describe(
            "Show logs since timestamp or relative (e.g. '10m', '1h', '2026-03-19T00:00:00')",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      instance,
      container,
      lines,
      since,
    }: {
      instance: VpsInstance;
      container: string;
      lines: number;
      since?: string;
    }) => {
      try {
        const docker = dockerCmdPrefix(instance);
        let cmd = `${docker} logs --tail ${lines}`;
        if (since) cmd += ` --since ${since}`;
        cmd += ` ${container} 2>&1`;

        const result = await vpsExec(instance, cmd, {
          timeout: 15000,
          allowFailure: true,
        });
        return {
          content: [
            {
              type: 'text',
              text: result.stdout || result.stderr || '(no output)',
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleVpsError(instance, error) }],
        };
      }
    },
  );

  // ── Docker Stats ─────────────────────────────────────────────────

  server.registerTool(
    'vps_docker_stats',
    {
      title: 'Docker Container Resource Usage',
      description:
        'Get current CPU, memory, network, and disk I/O usage for all running containers on the selected VPS. ' +
        "One-shot snapshot (not streaming). Targets Hetzner prod by default; pass instance='dev' for " +
        'the OrbStack ubuntu machine.',
      inputSchema: {
        instance: instanceSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ instance }: { instance: VpsInstance }) => {
      try {
        const docker = dockerCmdPrefix(instance);
        const result = await vpsExec(
          instance,
          `${docker} stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}\\t{{.BlockIO}}'`,
          { timeout: 15000 },
        );
        return {
          content: [{ type: 'text', text: result.stdout }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: handleVpsError(instance, error) }],
        };
      }
    },
  );
}
