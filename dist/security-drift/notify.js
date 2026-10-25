// Immediate URGENT notification, reusing the Resend email path the drift pipeline
// already uses (scripts/drift-audit.sh). Best-effort and non-fatal — a failed email
// must never block the runner. Bodies carry the scanner's already-redacted detail
// only; never secret values.
import { sendAlert } from '../alert-hub.js';
/** The hub's message limits: an alert holds 4,000 characters, a notice 12,000. */
const HUB_MESSAGE_LIMIT = { alert: 4000, notice: 12000 };
const SKEW_KEY = 'security-drift-version-skew';
const CUT_MARKER = '… (cut; full list at https://change-mgr.alobar.net)';
/** Channel config for the headless CLIs: the hub when ALERT_HUB_TOKEN is set, Resend otherwise. */
export function notifyDepsFromEnv() {
    return {
        hubToken: process.env.ALERT_HUB_TOKEN,
        resendApiKey: process.env.RESEND_API_KEY,
        from: process.env.INFRADRIFT_EMAIL_FROM ?? 'infra@devonwatkins.com',
        to: process.env.INFRADRIFT_EMAIL_TO ?? 'devon.watkins@gmail.com',
    };
}
function renderBody(items) {
    const lines = [
        `${items.length} new URGENT security finding(s) need approval at https://change-mgr.alobar.net`,
        '',
    ];
    for (const e of items) {
        lines.push(`• ${e.target.name}`);
        lines.push(`  ${e.reasoning}`);
        const rem = 'manual' in e.plan.remediation
            ? e.plan.remediation.manual.join('; ')
            : 'rotation' in e.plan.remediation
                ? `credential rotation plan for ${e.plan.remediation.rotation.credId} (${e.plan.remediation.rotation.credClass}) — approve in change-manager; console steps in the item`
                : e.plan.remediation.exec.map((c) => c.join(' ')).join(' && ');
        lines.push(`  remediation: ${rem}`);
        lines.push('');
    }
    lines.push('Note: ' + e0(items));
    return lines.join('\n');
}
// blind-spots footer (same text for all; pull from the first item)
function e0(items) {
    return items[0]?.plan.blind_spots ?? '';
}
/** Cut to the hub's limit for `kind`, ending with a pointer to the full list. */
function fitHubMessage(text, kind) {
    const limit = HUB_MESSAGE_LIMIT[kind];
    if (text.length <= limit)
        return text;
    let head = text.slice(0, limit - CUT_MARKER.length - 1);
    const last = head.charCodeAt(head.length - 1);
    if (last >= 0xd800 && last <= 0xdbff)
        head = head.slice(0, -1); // don't split a surrogate pair
    return `${head}\n${CUT_MARKER}`;
}
/** Low-level Resend send. Best-effort: skips when no key, returns false on any failure. */
async function sendResend(subject, text, deps) {
    if (!deps.resendApiKey)
        return false; // no key configured → skip (non-fatal)
    const doFetch = deps.fetchImpl ?? fetch;
    try {
        const res = await doFetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${deps.resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: deps.from, to: [deps.to], subject, text }),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
/**
 * Send an urgent message through alert-hub when a hub token is set; on a hub failure, or with no
 * token, send it through Resend with `title` as the subject, so an outage never loses it.
 * An event is a `notice` (the hub never dedups it); a state that later clears is an `alert`.
 */
export async function sendUrgentAlert(key, title, text, deps, kind = 'notice') {
    if (deps.hubToken) {
        const sent = await sendAlert({
            key,
            severity: 'critical',
            status: 'firing',
            kind,
            title,
            message: fitHubMessage(text, kind),
        }, { token: deps.hubToken, url: deps.hubUrl, fetchImpl: deps.fetchImpl });
        if (sent)
            return true;
    }
    return sendResend(title, text, deps);
}
function urgentTitle(items) {
    return `🚨 URGENT security drift — ${items.length} item(s) need approval now`;
}
/** Send the immediate URGENT notice for this run's new items. True on delivery. */
export async function sendUrgentEmail(items, deps, now) {
    if (!items.length)
        return false;
    const key = `security-urgent:${now.slice(0, 10)}`;
    return sendUrgentAlert(key, urgentTitle(items), renderBody(items), deps);
}
/** Scanner version skew is a state: an alert that stays open until a clean run resolves it. */
export async function sendVersionSkewAlert(items, deps) {
    if (!items.length)
        return false;
    return sendUrgentAlert(SKEW_KEY, urgentTitle(items), renderBody(items), deps, 'alert');
}
/** Close the skew alert after a run with no skew. Hub only: a resolve is never emailed. */
export async function resolveVersionSkew(deps) {
    if (!deps.hubToken)
        return false;
    return sendAlert({
        key: SKEW_KEY,
        severity: 'critical',
        status: 'resolved',
        kind: 'alert',
        title: 'Scanner output version matches again',
    }, { token: deps.hubToken, url: deps.hubUrl, fetchImpl: deps.fetchImpl });
}
//# sourceMappingURL=notify.js.map