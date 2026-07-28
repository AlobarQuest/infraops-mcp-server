import type { ObservationCommand } from './observation.js';

export interface ObservationResponse {
  id: string;
  source_reference: string;
  recorded_by: string;
  received_at: string;
  idempotency_key: string;
}

/**
 * Minimal client for the orchestrator's observation spine. Every M2M route requires BOTH the
 * bearer and the credential key id; sending one without the other authenticates as nobody.
 *
 * `sds.alobar.net` is not Cloudflare-proxied, so a default UA would work — the explicit one is
 * for attribution in access logs, not to get past a bot check.
 */
export class OrchestratorClient {
  private readonly base: string;

  constructor(
    base: string,
    private token: string,
    private credentialKeyId: string,
  ) {
    this.base = base.replace(/\/+$/, '');
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    return (await res.json()) as T;
  }

  postObservation(command: ObservationCommand): Promise<ObservationResponse> {
    return this.req<ObservationResponse>('/api/v1/observations', {
      method: 'POST',
      body: JSON.stringify(command),
    });
  }
}
