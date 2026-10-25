// Immediate URGENT notification through alert-hub. Best-effort and non-fatal — a failed
// send must never block the runner. Bodies carry the scanner's already-redacted detail
// only; never secret values.
import { sendAlert } from '../alert-hub.js';
/** The hub's message limits: an alert holds 4,000 characters, a notice 12,000. */
const HUB_MESSAGE_LIMIT = { alert: 4000, notice: 12000 };
const SKEW_KEY = 'security-drift-version-skew';
const CUT_MARKER = '… (cut; full list at https://change-mgr.alobar.net)';
/** Hub config for the headless CLIs: the token comes from ALERT_HUB_TOKEN. */
export function notifyDepsFromEnv() {
    return {
        hubToken: process.env.ALERT_HUB_TOKEN,
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
/** The hub rejects a request body over 16,384 bytes; the message is JSON-encoded inside it. */
const HUB_MESSAGE_BYTE_LIMIT = 15000;
function fitsHub(text, limit) {
    return (text.length <= limit &&
        Buffer.byteLength(JSON.stringify(text), 'utf8') <= HUB_MESSAGE_BYTE_LIMIT);
}
/**
 * Cut to the hub's limits for `kind` (characters and JSON-encoded bytes), ending with a pointer to
 * the full list. Finds the longest head that still fits with the pointer appended.
 */
function fitHubMessage(text, kind) {
    const limit = HUB_MESSAGE_LIMIT[kind];
    if (fitsHub(text, limit))
        return text;
    let lo = 0;
    let hi = Math.min(text.length, limit);
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fitsHub(`${text.slice(0, mid)}\n${CUT_MARKER}`, limit))
            lo = mid;
        else
            hi = mid - 1;
    }
    let head = text.slice(0, lo);
    const last = head.charCodeAt(head.length - 1);
    if (last >= 0xd800 && last <= 0xdbff)
        head = head.slice(0, -1); // don't split a surrogate pair
    return `${head}\n${CUT_MARKER}`;
}
/**
 * Send an urgent message through alert-hub. A hub failure (or a missing token) logs one line, never
 * the token, and returns false. An event is a `notice` (the hub never dedups it); a state that
 * later clears is an `alert`.
 */
export async function sendUrgentAlert(key, title, text, deps, kind = 'notice') {
    return sendAlert({
        key,
        severity: 'critical',
        status: 'firing',
        kind,
        title,
        message: fitHubMessage(text, kind),
    }, { token: deps.hubToken, url: deps.hubUrl, fetchImpl: deps.fetchImpl });
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