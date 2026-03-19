/**
 * VPS operations tools — SSH-based commands on the Hetzner VPS.
 *
 * These use the ssh2 library to connect directly, bypassing local ssh config.
 * Provides shell access, health monitoring, file operations, and Docker inspection.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  sshExec,
  sshReadFile,
  sshWriteFile,
  handleSSHError,
} from "../services/ssh-client.js";

export function registerVPSTools(server: McpServer): void {
  // ── Execute Command ──────────────────────────────────────────────

  server.registerTool(
    "vps_exec",
    {
      title: "Execute VPS Command",
      description:
        "Run a shell command on the VPS via SSH. Returns stdout, stderr, and exit code. " +
        "Use for any ad-hoc operation: checking processes, installing packages, inspecting logs, etc.",
      inputSchema: {
        command: z
          .string()
          .min(1)
          .describe("Shell command to execute on the VPS"),
        timeout: z
          .number()
          .int()
          .min(5000)
          .max(300000)
          .default(30000)
          .describe("Timeout in milliseconds (default: 30000, max: 300000)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ command, timeout }: { command: string; timeout: number }) => {
      try {
        const result = await sshExec(command, { timeout, allowFailure: true });
        const output = [
          `Exit code: ${result.exitCode}`,
          result.stdout ? `\n--- stdout ---\n${result.stdout}` : "",
          result.stderr ? `\n--- stderr ---\n${result.stderr}` : "",
        ].join("");

        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleSSHError(error) }],
        };
      }
    }
  );

  // ── VPS Health ───────────────────────────────────────────────────

  server.registerTool(
    "vps_health",
    {
      title: "VPS Health Check",
      description:
        "Get a comprehensive health snapshot of the VPS: uptime, CPU load, memory usage, " +
        "disk usage, running Docker containers count, and top processes by CPU.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const healthCommand = [
          "echo '=== UPTIME ==='",
          "uptime",
          "echo ''",
          "echo '=== MEMORY ==='",
          "free -h",
          "echo ''",
          "echo '=== DISK ==='",
          "df -h / /var/lib/docker 2>/dev/null || df -h /",
          "echo ''",
          "echo '=== CPU LOAD ==='",
          "cat /proc/loadavg",
          "echo ''",
          "echo '=== DOCKER CONTAINERS ==='",
          "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo 'Docker not available'",
          "echo ''",
          "echo '=== TOP PROCESSES (CPU) ==='",
          "ps aux --sort=-%cpu | head -10",
        ].join(" && ");

        const result = await sshExec(healthCommand, { timeout: 15000 });
        return {
          content: [{ type: "text", text: result.stdout }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleSSHError(error) }],
        };
      }
    }
  );

  // ── Read File ────────────────────────────────────────────────────

  server.registerTool(
    "vps_read_file",
    {
      title: "Read VPS File",
      description: "Read the contents of a file on the VPS.",
      inputSchema: {
        path: z.string().min(1).describe("Absolute path to the file on the VPS"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ path }: { path: string }) => {
      try {
        const content = await sshReadFile(path);
        return {
          content: [{ type: "text", text: content }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleSSHError(error) }],
        };
      }
    }
  );

  // ── Write File ───────────────────────────────────────────────────

  server.registerTool(
    "vps_write_file",
    {
      title: "Write VPS File",
      description:
        "Write content to a file on the VPS. Creates the file if it doesn't exist, overwrites if it does.",
      inputSchema: {
        path: z.string().min(1).describe("Absolute path for the file on the VPS"),
        content: z.string().describe("Content to write"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ path, content }: { path: string; content: string }) => {
      try {
        await sshWriteFile(path, content);
        return {
          content: [{ type: "text", text: `File written: ${path}` }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleSSHError(error) }],
        };
      }
    }
  );

  // ── Docker PS ────────────────────────────────────────────────────

  server.registerTool(
    "vps_docker_ps",
    {
      title: "List Docker Containers",
      description:
        "List running Docker containers on the VPS. Shows name, image, status, ports, and resource usage.",
      inputSchema: {
        all: z
          .boolean()
          .default(false)
          .describe("Include stopped containers (default: false)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ all }: { all: boolean }) => {
      try {
        const flag = all ? " -a" : "";
        const result = await sshExec(
          `docker ps${flag} --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Size}}'`,
          { timeout: 15000 }
        );
        return {
          content: [{ type: "text", text: result.stdout }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleSSHError(error) }],
        };
      }
    }
  );

  // ── Docker Logs ──────────────────────────────────────────────────

  server.registerTool(
    "vps_docker_logs",
    {
      title: "Get Docker Container Logs",
      description:
        "Retrieve logs from a Docker container on the VPS. Useful for debugging app issues directly.",
      inputSchema: {
        container: z
          .string()
          .min(1)
          .describe("Container name or ID"),
        lines: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe("Number of log lines to tail (default: 100)"),
        since: z
          .string()
          .optional()
          .describe("Show logs since timestamp or relative (e.g. '10m', '1h', '2026-03-19T00:00:00')"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      container,
      lines,
      since,
    }: {
      container: string;
      lines: number;
      since?: string;
    }) => {
      try {
        let cmd = `docker logs --tail ${lines}`;
        if (since) cmd += ` --since ${since}`;
        cmd += ` ${container} 2>&1`;

        const result = await sshExec(cmd, { timeout: 15000, allowFailure: true });
        return {
          content: [{ type: "text", text: result.stdout || result.stderr || "(no output)" }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleSSHError(error) }],
        };
      }
    }
  );

  // ── Docker Stats ─────────────────────────────────────────────────

  server.registerTool(
    "vps_docker_stats",
    {
      title: "Docker Container Resource Usage",
      description:
        "Get current CPU, memory, network, and disk I/O usage for all running containers. " +
        "One-shot snapshot (not streaming).",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await sshExec(
          "docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}\\t{{.BlockIO}}'",
          { timeout: 15000 }
        );
        return {
          content: [{ type: "text", text: result.stdout }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: handleSSHError(error) }],
        };
      }
    }
  );
}
