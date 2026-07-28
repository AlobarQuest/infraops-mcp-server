import type { ObservationCommand } from './observation.js';

export interface ObservationResponse {
  id: string;
  source_reference: string;
  recorded_by: string;
  received_at: string;
  idempotency_key: string;
}

export interface FollowUpMintResponse {
  minted: Array<{ work_unit_id: string; work_package_revision_id: string; due_at: string }>;
  skipped: Array<{ work_package_revision_id: string; reason: string }>;
  considered: number;
}

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
    return (await res.json()) as T;
  }

  postObservation(command: ObservationCommand): Promise<ObservationResponse> {
    return this.req<ObservationResponse>('/api/v1/observations', {
      method: 'POST',
      body: JSON.stringify(command),
    });
  }

  mintFollowUps(idempotencyKey: string): Promise<FollowUpMintResponse> {
    return this.req<FollowUpMintResponse>('/api/v1/follow-ups/mint', {
      method: 'POST',
      body: JSON.stringify({ idempotency_key: idempotencyKey, expected_version: 0 }),
    });
  }
}
