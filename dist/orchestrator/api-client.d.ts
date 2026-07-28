import type { ObservationCommand } from './observation.js';
export interface ObservationResponse {
    id: string;
    source_reference: string;
    recorded_by: string;
    received_at: string;
    idempotency_key: string;
}
export interface FollowUpMintResponse {
    minted: Array<{
        work_unit_id: string;
        work_package_revision_id: string;
        due_at: string;
    }>;
    skipped: Array<{
        work_package_revision_id: string;
        reason: string;
    }>;
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
export declare class OrchestratorClient {
    private token;
    private credentialKeyId;
    private readonly base;
    constructor(base: string, token: string, credentialKeyId: string);
    private req;
    postObservation(command: ObservationCommand): Promise<ObservationResponse>;
    mintFollowUps(idempotencyKey: string): Promise<FollowUpMintResponse>;
}
//# sourceMappingURL=api-client.d.ts.map