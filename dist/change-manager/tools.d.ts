import type { CoolifyInstance } from '../services/coolify-client.js';
export interface ToolCtx {
    instance: CoolifyInstance;
    rollback: Record<string, unknown>;
    /** Epoch ms when the domains write happened — scopes the post-verify deployment poll to THIS change. */
    domainsChangedAt?: number;
}
export type DeployVerdict = 'success' | 'failed' | 'pending' | 'unknown';
/**
 * Verdict on the newest deployment triggered at/after `sinceMs` for an app.
 * `unknown` = no such deployment found OR a read error — the caller treats it as
 * inconclusive (never a revert trigger on its own). Endpoint is the non-obvious
 * `/deployments/applications/{uuid}` (see CLAUDE.md), returning `{ deployments: [] }`.
 */
export declare function deploymentSucceeded(uuid: string, sinceMs: number, instance: CoolifyInstance): Promise<DeployVerdict>;
/**
 * True iff a raw TLS handshake to `<domain>:443` completes with a chain Node's trust
 * store accepts (`socket.authorized`). This is the live-cert proof the config check
 * cannot give. TLS verification stays ON — a self-signed/expired/missing cert → false.
 */
export declare function httpsLive(domain: string, timeoutMs?: number): Promise<boolean>;
/** First domain string on an app (for the live-cert probe). */
export declare function firstDomain(app: Record<string, unknown>): string;
/** JSON-schema tool definitions handed to the model. Read tools + the two write tools + control tools. */
export declare const TOOLS: readonly [{
    readonly name: 'get_application';
    readonly description: "Read a Coolify application's current config.";
    readonly input_schema: {
        readonly type: 'object';
        readonly properties: {
            readonly uuid: {
                readonly type: 'string';
            };
        };
        readonly required: readonly ['uuid'];
    };
}, {
    readonly name: 'set_application_domains';
    readonly description: "Set an application's domains (e.g. change http:// to https://). Captures the original for rollback.";
    readonly input_schema: {
        readonly type: 'object';
        readonly properties: {
            readonly uuid: {
                readonly type: 'string';
            };
            readonly domains: {
                readonly type: 'string';
                readonly description: 'comma-separated https URLs';
            };
        };
        readonly required: readonly ['uuid', 'domains'];
    };
}, {
    readonly name: 'set_application_healthcheck';
    readonly description: "Enable an application's health check at a verified path/port.";
    readonly input_schema: {
        readonly type: 'object';
        readonly properties: {
            readonly uuid: {
                readonly type: 'string';
            };
            readonly path: {
                readonly type: 'string';
            };
            readonly port: {
                readonly type: 'number';
            };
        };
        readonly required: readonly ['uuid', 'path', 'port'];
    };
}, {
    readonly name: 'redeploy_application';
    readonly description: 'Restart/redeploy an application so routing/cert changes take effect.';
    readonly input_schema: {
        readonly type: 'object';
        readonly properties: {
            readonly uuid: {
                readonly type: 'string';
            };
        };
        readonly required: readonly ['uuid'];
    };
}, {
    readonly name: 'report_done';
    readonly description: 'Call when the remediation is complete and verified.';
    readonly input_schema: {
        readonly type: 'object';
        readonly properties: {
            readonly summary: {
                readonly type: 'string';
            };
        };
        readonly required: readonly ['summary'];
    };
}, {
    readonly name: 'report_blocked';
    readonly description: 'Call when the change cannot be completed (missing prerequisite or needs human judgment).';
    readonly input_schema: {
        readonly type: 'object';
        readonly properties: {
            readonly reason: {
                readonly type: 'string';
            };
        };
        readonly required: readonly ['reason'];
    };
}];
/** Execute one tool call. Write tools capture rollback + validate. Throws on unknown tool (defense in depth). */
export declare function runTool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string>;
/** True only when every domain on the app is https:// — the HTTPS post-/pre-verify check. */
export declare function httpsConformant(app: Record<string, unknown>): boolean;
/** Revert a captured rollback (domains and/or health fields). Best-effort; idempotent per-dimension. */
export declare function revertRollback(uuid: string, rollback: Record<string, unknown>, instance: CoolifyInstance): Promise<void>;
//# sourceMappingURL=tools.d.ts.map