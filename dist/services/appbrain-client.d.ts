/** A resolved app-brain environment. github_repo/branch/url may be null per the contract;
 *  the handoff builder treats a null/empty repo OR branch as UNCONFIRMED. */
export interface AppResolution {
    github_repo: string | null;
    name: string;
    branch: string | null;
    url: string | null;
}
/** Type-validate the 200 body. Throws on a malformed shape (treated as a resolver error upstream,
 *  never confirmed). github_repo/branch/url may legitimately be null — that is incomplete, not
 *  malformed, and is resolved to UNCONFIRMED by the handoff builder. */
export declare function validateResolution(body: unknown): AppResolution;
/** Resolve a Coolify app to its repo+branch. 200 → validated body; 404 → null; anything else throws. */
export declare function resolveApp(args: {
    coolifyAppUuid: string;
    fqdn: string | null;
}): Promise<AppResolution | null>;
export declare function isAppbrainConfigured(): boolean;
//# sourceMappingURL=appbrain-client.d.ts.map