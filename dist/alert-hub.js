/** Vendored verbatim from alert-hub clients/typescript/alertHub.ts at alert-hub commit af458ab. */
/** Send alerts and notices to alert-hub. Dependency-free; copy this file into your repo. */
const DEFAULT_URL = 'https://alerts.alobar.net';
function envVar(name) {
    const g = globalThis;
    return g.process?.env?.[name];
}
/** Releases the connection. Only the status matters, so a body that can't be cancelled is fine. */
async function discardBody(res) {
    try {
        await res.body?.cancel();
    }
    catch {
        // Deliberately ignored: a missing or failing cancel must never turn a 202 into a failure.
    }
}
/**
 * Posts one alert to the hub. Resolves true on 202; otherwise logs one line and resolves false.
 * The hub validates the payload, so an invalid combination is sent anyway and comes back 400.
 */
export async function sendAlert(input, opts = {}) {
    const token = opts.token ?? envVar('ALERT_HUB_TOKEN');
    if (!token) {
        console.warn('alert-hub send failed: no token');
        return false;
    }
    const base = opts.url ?? envVar('ALERT_HUB_URL') ?? DEFAULT_URL;
    const send = opts.fetchImpl ?? fetch;
    const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    try {
        const res = await send(`${base.replace(/\/+$/, '')}/v1/alerts`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'alert-hub-client/1 (typescript)',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
        await discardBody(res);
        if (res.status === 202)
            return true;
        console.warn(`alert-hub send failed: HTTP ${res.status}`);
    }
    catch (err) {
        console.warn(`alert-hub send failed: ${err instanceof Error ? err.name : 'error'}`);
    }
    return false;
}
//# sourceMappingURL=alert-hub.js.map