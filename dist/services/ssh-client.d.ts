/**
 * SSH client for VPS operations.
 *
 * Uses the ssh2 library to connect programmatically — does not depend on
 * the local ssh config or ssh-agent being set up correctly.
 *
 * Environment variables:
 *   VPS_HOST            - VPS IP address (default: 178.156.247.239)
 *   VPS_USER            - SSH user (default: root)
 *   VPS_SSH_KEY_PATH    - Path to SSH private key (default: ~/.ssh/hetzner_ed25519)
 *   VPS_SSH_PASSPHRASE  - Key passphrase (optional, loaded from BWS)
 */
/**
 * Execute a command on the VPS via SSH and return stdout + stderr.
 * Rejects if the command exits non-zero (unless allowFailure is true).
 */
export declare function sshExec(command: string, options?: {
    timeout?: number;
    allowFailure?: boolean;
}): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
}>;
/**
 * Read a file from the VPS via SSH (cat).
 */
export declare function sshReadFile(path: string): Promise<string>;
/**
 * Write content to a file on the VPS via SSH.
 */
export declare function sshWriteFile(path: string, content: string): Promise<void>;
export declare function handleSSHError(error: unknown): string;
/** Check if SSH is configured (key file exists) */
export declare function isSSHConfigured(): boolean;
//# sourceMappingURL=ssh-client.d.ts.map