/**
 * Minimal client for the orchestrator's observation spine. Every M2M route requires BOTH the
 * bearer and the credential key id; sending one without the other authenticates as nobody.
 *
 * `sds.alobar.net` is not Cloudflare-proxied, so a default UA would work — the explicit one is
 * for attribution in access logs, not to get past a bot check.
 *
 * Every request carries a default 20s timeout: Node/undici's own default lets a
 * hung-but-accepted connection stall for ~300s, which -- run before the Resend digest and the
 * Healthchecks ping -- can trigger a false dead-man's-switch alarm about the whole drift job
 * while the job itself is fine. Callers may override via `init.signal`.
 */
export class OrchestratorClient {
    token;
    credentialKeyId;
    base;
    constructor(base, token, credentialKeyId) {
        this.token = token;
        this.credentialKeyId = credentialKeyId;
        this.base = base.replace(/\/+$/, '');
    }
    async req(path, init = {}) {
        const res = await fetch(`${this.base}${path}`, {
            signal: AbortSignal.timeout(20_000),
            ...init,
            headers: {
                Authorization: `Bearer ${this.token}`,
                'X-Credential-Key-Id': this.credentialKeyId,
                'Content-Type': 'application/json',
                'User-Agent': 'infra-drift-observer/1 (+infraops-mcp-server)',
                ...(init.headers ?? {}),
            },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`orchestrator ${path} -> ${res.status}: ${body.slice(0, 200)}`);
        }
        return (await res.json());
    }
    postObservation(command) {
        return this.req('/api/v1/observations', {
            method: 'POST',
            body: JSON.stringify(command),
        });
    }
    mintFollowUps(idempotencyKey) {
        return this.req('/api/v1/follow-ups/mint', {
            method: 'POST',
            body: JSON.stringify({ idempotency_key: idempotencyKey, expected_version: 0 }),
        });
    }
}
//# sourceMappingURL=api-client.js.map