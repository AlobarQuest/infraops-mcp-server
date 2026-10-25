/** Vendored verbatim from alert-hub clients/typescript/alertHub.ts at alert-hub commit af458ab. */
/** Send alerts and notices to alert-hub. Dependency-free; copy this file into your repo. */
export interface AlertInput {
    key: string;
    severity: string;
    title: string;
    message?: string;
    status?: 'firing' | 'resolved';
    kind?: 'alert' | 'notice';
    link?: string;
    details?: Record<string, unknown>;
}
export interface SendOptions {
    token?: string;
    url?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}
/**
 * Posts one alert to the hub. Resolves true on 202; otherwise logs one line and resolves false.
 * The hub validates the payload, so an invalid combination is sent anyway and comes back 400.
 */
export declare function sendAlert(input: AlertInput, opts?: SendOptions): Promise<boolean>;
//# sourceMappingURL=alert-hub.d.ts.map