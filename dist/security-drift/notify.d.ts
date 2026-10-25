import type { SecurityEscalation } from './emit.js';
type HubKind = 'alert' | 'notice';
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
 * Send an urgent message through alert-hub when a hub token is set; on a hub failure, or with no
 * token, send it through Resend with `title` as the subject, so an outage never loses it.
 * An event is a `notice` (the hub never dedups it); a state that later clears is an `alert`.
 */
export declare function sendUrgentAlert(key: string, title: string, text: string, deps: NotifyDeps, kind?: HubKind): Promise<boolean>;
/** Send the immediate URGENT notice for this run's new items. True on delivery. */
export declare function sendUrgentEmail(items: SecurityEscalation[], deps: NotifyDeps, now: string): Promise<boolean>;
/** Scanner version skew is a state: an alert that stays open until a clean run resolves it. */
export declare function sendVersionSkewAlert(items: SecurityEscalation[], deps: NotifyDeps): Promise<boolean>;
/** Close the skew alert after a run with no skew. Hub only: a resolve is never emailed. */
export declare function resolveVersionSkew(deps: NotifyDeps): Promise<boolean>;
export {};
//# sourceMappingURL=notify.d.ts.map