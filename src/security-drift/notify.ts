// Immediate URGENT notification, reusing the Resend email path the drift pipeline
// already uses (scripts/drift-audit.sh). Best-effort and non-fatal — a failed email
// must never block the runner. Bodies carry the scanner's already-redacted detail
// only; never secret values.

import type { SecurityEscalation } from "./emit.js";

export interface NotifyDeps {
  resendApiKey?: string;
  from: string;
  to: string;
  fetchImpl?: typeof fetch;
}

function renderBody(items: SecurityEscalation[]): string {
  const lines = [`${items.length} new URGENT security finding(s) need approval at https://change-mgr.alobar.net`, ""];
  for (const e of items) {
    lines.push(`• ${e.target.name}`);
    lines.push(`  ${e.reasoning}`);
    const rem = "manual" in e.plan.remediation ? e.plan.remediation.manual.join("; ") : e.plan.remediation.exec.map((c) => c.join(" ")).join(" && ");
    lines.push(`  remediation: ${rem}`);
    lines.push("");
  }
  lines.push("Note: " + e0(items));
  return lines.join("\n");
}
// blind-spots footer (same text for all; pull from the first item)
function e0(items: SecurityEscalation[]): string {
  return items[0]?.plan.blind_spots ?? "";
}

/** Send the immediate URGENT email. Returns true on a 2xx, false if skipped or failed. */
export async function sendUrgentEmail(items: SecurityEscalation[], deps: NotifyDeps): Promise<boolean> {
  if (!items.length) return false;
  if (!deps.resendApiKey) return false; // no key configured → skip (non-fatal)
  const doFetch = deps.fetchImpl ?? fetch;
  const payload = {
    from: deps.from,
    to: [deps.to],
    subject: `🚨 URGENT security drift — ${items.length} item(s) need approval now`,
    text: renderBody(items),
  };
  try {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
