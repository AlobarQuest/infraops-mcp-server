/**
 * VPS dispatcher — routes VPS operations to the correct backend based on instance.
 *
 *   instance: "prod" → sshExec (Hetzner at 178.156.247.239, root)
 *   instance: "dev"  → orbExec (OrbStack ubuntu machine, devon)
 *
 * This mirrors the multi-instance pattern already in place for coolify-client.ts so that
 * `coolify_list_applications({instance: "dev"})` and a follow-up `vps_exec({instance: "dev", ...})`
 * land on the same host instead of silently diverging.
 *
 * The dev user is non-root and not in the `docker` group, so docker commands must be
 * prefixed with `sudo`. Use `dockerCmdPrefix(instance)` inside the docker-specific tools
 * so callers never have to think about it.
 */

import { sshExec, sshReadFile, sshWriteFile, handleSSHError } from "./ssh-client.js";
import { orbExec, getOrbMachine, handleOrbError } from "./orb-client.js";

export type VpsInstance = "prod" | "dev";

export interface VpsExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface VpsExecOptions {
  timeout?: number;
  allowFailure?: boolean;
}

/**
 * Execute a shell command on the selected VPS instance.
 *
 * - prod → SSH into Hetzner (existing code path, untouched)
 * - dev  → `orb run -m <machine> bash -c <command>`
 */
export async function vpsExec(
  instance: VpsInstance,
  command: string,
  options: VpsExecOptions = {}
): Promise<VpsExecResult> {
  if (instance === "dev") {
    return orbExec(getOrbMachine(), command, options);
  }
  return sshExec(command, options);
}

/**
 * Read a file from the selected VPS instance.
 * Routes through `cat` on dev so we don't need SFTP on the OrbStack machine.
 */
export async function vpsReadFile(
  instance: VpsInstance,
  path: string
): Promise<string> {
  if (instance === "prod") {
    return sshReadFile(path);
  }
  const result = await vpsExec(instance, `cat ${escapeShell(path)}`, {
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read ${path}: ${result.stderr || "(empty)"}`);
  }
  return result.stdout;
}

/**
 * Write content to a file on the selected VPS instance.
 * Uses a heredoc so arbitrary content (including quotes) round-trips safely.
 */
export async function vpsWriteFile(
  instance: VpsInstance,
  path: string,
  content: string
): Promise<void> {
  if (instance === "prod") {
    return sshWriteFile(path, content);
  }
  const command = `cat > ${escapeShell(path)} << 'INFRAOPS_EOF'\n${content}\nINFRAOPS_EOF`;
  const result = await vpsExec(instance, command, { allowFailure: true });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to write ${path}: ${result.stderr || "(empty)"}`);
  }
}

/**
 * Return the appropriate `docker` invocation prefix for an instance.
 *
 * - prod: runs as root, so `docker ...` works directly
 * - dev:  runs as `devon` who is not in the docker group, so `sudo docker ...` is required
 *
 * Use this inside the docker-specific tools (vps_docker_ps, vps_docker_logs, vps_docker_stats,
 * vps_health) so callers don't have to know about the sudo split.
 */
export function dockerCmdPrefix(instance: VpsInstance): string {
  return instance === "dev" ? "sudo docker" : "docker";
}

/** Unified error formatter — picks the right handler based on instance. */
export function handleVpsError(instance: VpsInstance, error: unknown): string {
  return instance === "dev" ? handleOrbError(error) : handleSSHError(error);
}

/** Describe the target an instance resolves to (for tool response preambles, if desired). */
export function describeInstance(instance: VpsInstance): string {
  if (instance === "dev") return `OrbStack machine '${getOrbMachine()}' (dev)`;
  return `${process.env.VPS_HOST || "178.156.247.239"} (prod)`;
}

function escapeShell(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
