/**
 * GitHub REST API client.
 *
 * Provides deploy key management and repo creation via the GitHub API.
 * Requires a GITHUB_TOKEN env var (classic PAT with `repo` scope).
 */
export declare function githubGet<T>(endpoint: string, params?: Record<string, unknown>): Promise<T>;
export declare function githubPost<T>(endpoint: string, data?: Record<string, unknown>): Promise<T>;
export declare function githubDelete<T>(endpoint: string): Promise<T>;
export declare function handleGithubError(error: unknown): string;
/** Check if GitHub API is configured */
export declare function isGithubConfigured(): boolean;
//# sourceMappingURL=github-client.d.ts.map