/**
 * Coolify documentation search (BM25 over the official docs).
 *
 * Lazily fetches `https://coolify.io/docs/llms-full.txt` on first use, parses it into
 * page/section chunks, and indexes them with MiniSearch. The index is cached in memory
 * for the process lifetime (no TTL). Mirrors the approach used by @masonator/coolify-mcp.
 *
 * Instance-agnostic: the docs are global, so this has no Coolify instance/token dependency.
 */
export interface DocSearchResult {
    title: string;
    url: string;
    description: string;
    snippet: string;
    score: number;
}
/** Search the cached docs index, building it lazily on first call. */
export declare function searchDocs(query: string, limit?: number): Promise<DocSearchResult[]>;
//# sourceMappingURL=docs-search.d.ts.map