import type { SecurityEscalation } from './emit.js';
export interface NotifyDeps {
    resendApiKey?: string;
    from: string;
    to: string;
    hubToken?: string;
    hubUrl?: string;
    fetchImpl?: typeof fetch;
}
/** Channel config for the headless CLIs: the hub when ALERT_HUB_TOKEN is set, Resend otherwise. */
export declare function notifyDepsFromEnv(): NotifyDeps;
/**
 * Send an urgent alert through alert-hub when a hub token is set; on a hub failure, or with no
 * token, send it through Resend with `title` as the subject, so an outage never loses an alert.
 */
export declare function sendUrgentAlert(key: string, title: string, text: string, deps: NotifyDeps): Promise<boolean>;
/** Send the immediate URGENT alert. Returns true on delivery, false if skipped or failed. */
export declare function sendUrgentEmail(items: SecurityEscalation[], deps: NotifyDeps, key?: string): Promise<boolean>;
//# sourceMappingURL=notify.d.ts.map