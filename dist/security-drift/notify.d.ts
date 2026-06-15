import type { SecurityEscalation } from "./emit.js";
export interface NotifyDeps {
    resendApiKey?: string;
    from: string;
    to: string;
    fetchImpl?: typeof fetch;
}
/** Low-level Resend send. Best-effort: skips when no key, returns false on any failure. */
export declare function sendAlertEmail(subject: string, text: string, deps: NotifyDeps): Promise<boolean>;
/** Send the immediate URGENT email. Returns true on a 2xx, false if skipped or failed. */
export declare function sendUrgentEmail(items: SecurityEscalation[], deps: NotifyDeps): Promise<boolean>;
//# sourceMappingURL=notify.d.ts.map