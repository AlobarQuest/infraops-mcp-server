export interface SyncBody {
  generated_at: string;
  source_report: string;
  escalations: unknown[];
}
export interface SyncSummary {
  new: number;
  refreshed: number;
  resolved: number;
  reopened: number;
}
export interface ApprovedItem {
  id: number;
  identity: string;
  instance: string;
  rule_key: string;
  resource_type: string | null;
  resource_uuid: string;
  resource_name: string;
  risk: string;
  kind: string;
  reasoning: string;
  plan: Record<string, unknown>;
  note: string | null;
  status: string;
}
export interface OutcomeBody {
  outcome: "done" | "failed" | "blocked" | "skipped_conformant";
  detail?: string;
  tool_calls?: Record<string, unknown>;
  rollback?: Record<string, unknown>;
}

export class ChangeMgrClient {
  constructor(private base: string, private token: string) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`change-mgr ${path} -> ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  postSync(body: SyncBody): Promise<SyncSummary> {
    return this.req<SyncSummary>("/api/sync", { method: "POST", body: JSON.stringify(body) });
  }
  getApproved(): Promise<ApprovedItem[]> {
    return this.req<ApprovedItem[]>("/api/items?status=approved");
  }
  claim(id: number): Promise<ApprovedItem> {
    return this.req<ApprovedItem>(`/api/items/${id}/claim`, { method: "POST" });
  }
  postOutcome(id: number, body: OutcomeBody): Promise<unknown> {
    return this.req(`/api/items/${id}/outcome`, { method: "POST", body: JSON.stringify(body) });
  }
  startWindow(startedAt: string): Promise<{ id: number }> {
    return this.req<{ id: number }>("/api/window-runs", { method: "POST", body: JSON.stringify({ started_at: startedAt }) });
  }
  finishWindow(id: number, counts: Record<string, unknown>): Promise<unknown> {
    return this.req(`/api/window-runs/${id}`, { method: "PATCH", body: JSON.stringify(counts) });
  }
}
