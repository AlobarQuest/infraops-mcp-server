export class ChangeMgrClient {
    base;
    token;
    actor;
    constructor(base, token, actor = "executor") {
        this.base = base;
        this.token = token;
        this.actor = actor;
    }
    async req(path, init = {}) {
        const res = await fetch(`${this.base}${path}`, {
            ...init,
            headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`change-mgr ${path} -> ${res.status}: ${body.slice(0, 200)}`);
        }
        return (await res.json());
    }
    postSync(body) {
        return this.req("/api/sync", { method: "POST", body: JSON.stringify(body) });
    }
    getApproved() {
        return this.req("/api/items?status=approved");
    }
    getApprovedBySource(source) {
        return this.req(`/api/items?status=approved&source=${encodeURIComponent(source)}`);
    }
    claim(id) {
        return this.req(`/api/items/${id}/claim`, { method: "POST", body: JSON.stringify({ actor: this.actor }) });
    }
    postOutcome(id, body) {
        return this.req(`/api/items/${id}/outcome`, { method: "POST", body: JSON.stringify({ ...body, actor: this.actor }) });
    }
    startWindow(startedAt) {
        return this.req("/api/window-runs", { method: "POST", body: JSON.stringify({ started_at: startedAt }) });
    }
    finishWindow(id, counts) {
        return this.req(`/api/window-runs/${id}`, { method: "PATCH", body: JSON.stringify(counts) });
    }
}
//# sourceMappingURL=api-client.js.map