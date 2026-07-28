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
export declare class OrchestratorClient {
    private token;
    private credentialKeyId;
    private readonly base;
    constructor(base: string, token: string, credentialKeyId: string);
    private req;
    postObservation(command: ObservationCommand): Promise<ObservationResponse>;
}
//# sourceMappingURL=api-client.d.ts.map