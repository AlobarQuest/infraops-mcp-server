/**
 * OrbStack exec backend for VPS operations on the local dev machine.
 *
 * Runs commands inside an OrbStack-managed Linux machine via `orb run -m <machine> bash -c <cmd>`.
 * This is the "dev" counterpart to the SSH-based prod backend in ssh-client.ts — it needs
 * no authorized_keys setup because OrbStack exposes each machine natively on the host.
 *
 * Environment variables:
 *   VPS_DEV_ORB_MACHINE - OrbStack machine name for the dev VPS (default: "ubuntu")
 */
export interface OrbExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export declare function getOrbMachine(): string;
/**
 * Execute a shell command inside an OrbStack machine.
 *
 * Uses `orb run -m <machine> bash -c <command>` so the full command string is
 * interpreted by a login-less bash on the target machine — pipes, redirects,
 * and quoting all work the way they do for sshExec.
 */
export declare function orbExec(machine: string, command: string, options?: {
    timeout?: number;
    allowFailure?: boolean;
}): Promise<OrbExecResult>;
/** Check whether the orb CLI is reachable at all. Best-effort. */
export declare function isOrbConfigured(): boolean;
export declare function handleOrbError(error: unknown): string;
//# sourceMappingURL=orb-client.d.ts.map