import type { SecurityEscalation } from './emit.js';
type HubKind = 'alert' | 'notice';
export interface NotifyDeps {
    hubToken?: string;
    hubUrl?: string;
    fetchImpl?: typeof fetch;
}
/** Hub config for the headless CLIs: the token comes from ALERT_HUB_TOKEN. */
export declare function notifyDepsFromEnv(): NotifyDeps;
/**
 * Send an urgent message through alert-hub. A hub failure (or a missing token) logs one line, never
 * the token, and returns false. An event is a `notice` (the hub never dedups it); a state that
 * later clears is an `alert`.
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