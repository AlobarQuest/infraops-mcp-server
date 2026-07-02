// Immediate URGENT notification, reusing the Resend email path the drift pipeline
// already uses (scripts/drift-audit.sh). Best-effort and non-fatal — a failed email
// must never block the runner. Bodies carry the scanner's already-redacted detail
// only; never secret values.
function renderBody(items) {
    const lines = [`${items.length} new URGENT security finding(s) need approval at https://change-mgr.alobar.net`, ""];
    for (const e of items) {
        lines.push(`• ${e.target.name}`);
        lines.push(`  ${e.reasoning}`);
        const rem = "manual" in e.plan.remediation
            ? e.plan.remediation.manual.join("; ")
            : "rotation" in e.plan.remediation
                ? `credential rotation plan for ${e.plan.remediation.rotation.credId} (${e.plan.remediation.rotation.credClass}) — approve in change-manager; console steps in the item`
                : e.plan.remediation.exec.map((c) => c.join(" ")).join(" && ");
        lines.push(`  remediation: ${rem}`);
        lines.push("");
    }
    lines.push("Note: " + e0(items));
    return lines.join("\n");
}
// blind-spots footer (same text for all; pull from the first item)
function e0(items) {
    return items[0]?.plan.blind_spots ?? "";
}
/** Low-level Resend send. Best-effort: skips when no key, returns false on any failure. */
export async function sendAlertEmail(subject, text, deps) {
    if (!deps.resendApiKey)
        return false; // no key configured → skip (non-fatal)
    const doFetch = deps.fetchImpl ?? fetch;
    try {
        const res = await doFetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${deps.resendApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: deps.from, to: [deps.to], subject, text }),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
/** Send the immediate URGENT email. Returns true on a 2xx, false if skipped or failed. */
export async function sendUrgentEmail(items, deps) {
    if (!items.length)
        return false;
    return sendAlertEmail(`🚨 URGENT security drift — ${items.length} item(s) need approval now`, renderBody(items), deps);
}
//# sourceMappingURL=notify.js.map