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
export type VpsInstance = 'prod' | 'dev';
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
export declare function vpsExec(instance: VpsInstance, command: string, options?: VpsExecOptions): Promise<VpsExecResult>;
/**
 * Read a file from the selected VPS instance.
 * Routes through `cat` on dev so we don't need SFTP on the OrbStack machine.
 */
export declare function vpsReadFile(instance: VpsInstance, path: string): Promise<string>;
/**
 * Write content to a file on the selected VPS instance.
 * Uses a heredoc so arbitrary content (including quotes) round-trips safely.
 */
export declare function vpsWriteFile(instance: VpsInstance, path: string, content: string): Promise<void>;
/**
 * Return the appropriate `docker` invocation prefix for an instance.
 *
 * - prod: runs as root, so `docker ...` works directly
 * - dev:  runs as `devon` who is not in the docker group, so `sudo docker ...` is required
 *
 * Use this inside the docker-specific tools (vps_docker_ps, vps_docker_logs, vps_docker_stats,
 * vps_health) so callers don't have to know about the sudo split.
 */
export declare function dockerCmdPrefix(instance: VpsInstance): string;
/** Unified error formatter — picks the right handler based on instance. */
export declare function handleVpsError(instance: VpsInstance, error: unknown): string;
/** Describe the target an instance resolves to (for tool response preambles, if desired). */
export declare function describeInstance(instance: VpsInstance): string;
//# sourceMappingURL=vps-dispatch.d.ts.map