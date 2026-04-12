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
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export function getOrbMachine() {
    return process.env.VPS_DEV_ORB_MACHINE || "ubuntu";
}
/**
 * Execute a shell command inside an OrbStack machine.
 *
 * Uses `orb run -m <machine> bash -c <command>` so the full command string is
 * interpreted by a login-less bash on the target machine — pipes, redirects,
 * and quoting all work the way they do for sshExec.
 */
export async function orbExec(machine, command, options = {}) {
    const timeout = options.timeout ?? 30000;
    try {
        const { stdout, stderr } = await execFileAsync("orb", ["run", "-m", machine, "bash", "-c", command], {
            timeout,
            maxBuffer: 10 * 1024 * 1024,
        });
        return { stdout, stderr, exitCode: 0 };
    }
    catch (err) {
        const e = err;
        if (e.killed && e.signal === "SIGTERM") {
            throw new Error(`orb run timed out after ${timeout}ms on machine '${machine}': ${command}`);
        }
        if (e.code === "ENOENT") {
            throw new Error("orb CLI not found on PATH. Install OrbStack or ensure `orb` is available to the MCP process.");
        }
        const stdout = typeof e.stdout === "string" ? e.stdout : e.stdout?.toString() ?? "";
        const stderr = typeof e.stderr === "string" ? e.stderr : e.stderr?.toString() ?? "";
        const exitCode = typeof e.code === "number" ? e.code : 1;
        if (options.allowFailure) {
            return { stdout, stderr, exitCode };
        }
        throw new Error(`orb run failed (exit ${exitCode}) on machine '${machine}': ${stderr || e.message}`);
    }
}
/** Check whether the orb CLI is reachable at all. Best-effort. */
export function isOrbConfigured() {
    try {
        const res = spawnSync("orb", ["version"], { stdio: "ignore" });
        return res.status === 0 || res.status === null;
    }
    catch {
        return false;
    }
}
export function handleOrbError(error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("orb CLI not found"))
        return `Error: ${msg}`;
    if (msg.includes("timed out"))
        return `Error: ${msg}`;
    return `Error: orb run failed — ${msg}`;
}
//# sourceMappingURL=orb-client.js.map