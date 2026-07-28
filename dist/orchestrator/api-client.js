/**
 * Minimal client for the orchestrator's observation spine. Every M2M route requires BOTH the
 * bearer and the credential key id; sending one without the other authenticates as nobody.
 *
 * `sds.alobar.net` is not Cloudflare-proxied, so a default UA would work — the explicit one is
 * for attribution in access logs, not to get past a bot check.
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
}
//# sourceMappingURL=api-client.js.map