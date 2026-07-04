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
import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
function getSSHConfig() {
    const host = process.env.VPS_HOST || '178.156.247.239';
    const port = parseInt(process.env.VPS_PORT || '22', 10);
    const username = process.env.VPS_USER || 'root';
    const keyPath = process.env.VPS_SSH_KEY_PATH || resolve(homedir(), '.ssh', 'hetzner_ed25519');
    const passphrase = process.env.VPS_SSH_PASSPHRASE || undefined;
    let privateKey;
    try {
        privateKey = readFileSync(keyPath);
    }
    catch (err) {
        throw new Error(`Cannot read SSH key at ${keyPath}. ` +
            `Set VPS_SSH_KEY_PATH if the key is elsewhere. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { host, port, username, privateKey, passphrase };
}
// ── Public helpers ───────────────────────────────────────────────────
/**
 * Execute a command on the VPS via SSH and return stdout + stderr.
 * Rejects if the command exits non-zero (unless allowFailure is true).
 */
export async function sshExec(command, options = {}) {
    const config = getSSHConfig();
    const timeout = options.timeout ?? 30000;
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let stdout = '';
        let stderr = '';
        let exitCode = -1;
        const timer = setTimeout(() => {
            conn.end();
            reject(new Error(`SSH command timed out after ${timeout}ms: ${command}`));
        }, timeout);
        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    clearTimeout(timer);
                    conn.end();
                    reject(new Error(`SSH exec error: ${err.message}`));
                    return;
                }
                stream.on('close', (code) => {
                    clearTimeout(timer);
                    exitCode = code ?? 0;
                    conn.end();
                    if (exitCode !== 0 && !options.allowFailure) {
                        resolve({ stdout, stderr, exitCode });
                    }
                    else {
                        resolve({ stdout, stderr, exitCode });
                    }
                });
                stream.on('data', (data) => {
                    stdout += data.toString();
                });
                stream.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
            });
        });
        conn.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`SSH connection error: ${err.message}`));
        });
        conn.connect({
            host: config.host,
            port: config.port,
            username: config.username,
            privateKey: config.privateKey,
            passphrase: config.passphrase,
            readyTimeout: 10000,
        });
    });
}
/**
 * Read a file from the VPS via SSH (cat).
 */
export async function sshReadFile(path) {
    const result = await sshExec(`cat ${escapeShell(path)}`);
    if (result.exitCode !== 0) {
        throw new Error(`Failed to read ${path}: ${result.stderr}`);
    }
    return result.stdout;
}
/**
 * Write content to a file on the VPS via SSH.
 */
export async function sshWriteFile(path, content) {
    // Single-quoted heredoc delimiter disables shell expansion, so content
    // is passed through verbatim — no escaping of $, `, ", ' is needed.
    // Known edge case tracked in BACKLOG.md: content containing a line that
    // is literally "INFRAOPS_EOF" will terminate the heredoc early.
    const result = await sshExec(`cat > ${escapeShell(path)} << 'INFRAOPS_EOF'\n${content}\nINFRAOPS_EOF`);
    if (result.exitCode !== 0) {
        throw new Error(`Failed to write ${path}: ${result.stderr}`);
    }
}
// ── Error handler ────────────────────────────────────────────────────
export function handleSSHError(error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Authentication failed') ||
        msg.includes('All configured authentication methods failed')) {
        return ('Error: SSH authentication failed. Check that VPS_SSH_KEY_PATH points to the correct key, ' +
            'VPS_SSH_PASSPHRASE is set if the key is encrypted, and the public key is in the VPS authorized_keys.');
    }
    if (msg.includes('ECONNREFUSED')) {
        return 'Error: SSH connection refused. Check that VPS_HOST is correct and SSH is running on the VPS.';
    }
    if (msg.includes('timed out')) {
        return `Error: ${msg}. The VPS may be unreachable or the command is long-running. Try increasing the timeout.`;
    }
    if (msg.includes('Cannot read SSH key')) {
        return `Error: ${msg}`;
    }
    return `Error: SSH operation failed — ${msg}`;
}
/** Check if SSH is configured (key file exists) */
export function isSSHConfigured() {
    const keyPath = process.env.VPS_SSH_KEY_PATH || resolve(homedir(), '.ssh', 'hetzner_ed25519');
    try {
        readFileSync(keyPath);
        return true;
    }
    catch {
        return false;
    }
}
// ── Utility ──────────────────────────────────────────────────────────
function escapeShell(arg) {
    return `'${arg.replace(/'/g, "'\\''")}'`;
}
//# sourceMappingURL=ssh-client.js.map