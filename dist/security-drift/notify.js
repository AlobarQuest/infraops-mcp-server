// Immediate URGENT notification, reusing the Resend email path the drift pipeline
// already uses (scripts/drift-audit.sh). Best-effort and non-fatal — a failed email
// must never block the runner. Bodies carry the scanner's already-redacted detail
// only; never secret values.
import { createHash } from 'node:crypto';
import { sendAlert } from '../alert-hub.js';
const HUB_MESSAGE_LIMIT = 4000;
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
/** Cut to the hub's alert limit, ending with a pointer to the full list. */
function fitHubMessage(text) {
    if (text.length <= HUB_MESSAGE_LIMIT)
        return text;
    let head = text.slice(0, HUB_MESSAGE_LIMIT - CUT_MARKER.length - 1);
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
 * Send an urgent alert through alert-hub when a hub token is set; on a hub failure, or with no
 * token, send it through Resend with `title` as the subject, so an outage never loses an alert.
 */
export async function sendUrgentAlert(key, title, text, deps) {
    if (deps.hubToken) {
        const sent = await sendAlert({ key, severity: 'critical', status: 'firing', title, message: fitHubMessage(text) }, { token: deps.hubToken, url: deps.hubUrl, fetchImpl: deps.fetchImpl });
        if (sent)
            return true;
    }
    return sendResend(title, text, deps);
}
/** Key for one day's urgent set: a different set the same day must not collapse into one alert. */
function urgentKey(items) {
    const ids = items.map((e) => e.proposal_id).sort();
    const digest = createHash('sha256').update(JSON.stringify(ids)).digest('hex').slice(0, 8);
    return `security-urgent:${new Date().toISOString().slice(0, 10)}:${digest}`;
}
/** Send the immediate URGENT alert. Returns true on delivery, false if skipped or failed. */
export async function sendUrgentEmail(items, deps, key = urgentKey(items)) {
    if (!items.length)
        return false;
    return sendUrgentAlert(key, `🚨 URGENT security drift — ${items.length} item(s) need approval now`, renderBody(items), deps);
}
//# sourceMappingURL=notify.js.map