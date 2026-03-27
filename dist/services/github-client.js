/**
 * GitHub REST API client.
 *
 * Provides deploy key management and repo creation via the GitHub API.
 * Requires a GITHUB_TOKEN env var (classic PAT with `repo` scope).
 */
import axios from "axios";
import { REQUEST_TIMEOUT } from "../constants.js";
const GITHUB_API_BASE = "https://api.github.com";
// ── Singleton client ─────────────────────────────────────────────────
let _client = null;
function getClient() {
    if (_client)
        return _client;
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error("GITHUB_TOKEN environment variable is required. " +
            "Create a PAT with `repo` scope at https://github.com/settings/tokens. " +
            "Store it in BWS and set BWS_GITHUB_SECRET_ID in your MCP config.");
    }
    _client = axios.create({
        baseURL: GITHUB_API_BASE,
        timeout: REQUEST_TIMEOUT,
        headers: {
            "Content-Type": "application/json",
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    return _client;
}
// ── Public helpers ───────────────────────────────────────────────────
export async function githubGet(endpoint, params) {
    const client = getClient();
    const response = await client.get(endpoint, { params });
    return response.data;
}
export async function githubPost(endpoint, data) {
    const client = getClient();
    const response = await client.post(endpoint, data);
    return response.data;
}
export async function githubDelete(endpoint) {
    const client = getClient();
    const response = await client.delete(endpoint);
    return response.data;
}
// ── Error handler ────────────────────────────────────────────────────
export function handleGithubError(error) {
    if (axios.isAxiosError(error)) {
        const axErr = error;
        if (axErr.response) {
            const status = axErr.response.status;
            const body = axErr.response.data;
            const msg = body?.message ?? JSON.stringify(body);
            const details = body?.errors?.map((e) => e.message).join("; ");
            const full = details ? `${msg} — ${details}` : msg;
            switch (status) {
                case 401:
                    return ("Error: GitHub authentication failed. Your GITHUB_TOKEN may be invalid or expired. " +
                        "Regenerate it at https://github.com/settings/tokens.");
                case 403:
                    return `Error: GitHub permission denied. Your token may lack the required scope. ${full}`;
                case 404:
                    return `Error: GitHub resource not found. Check that the repo/key ID exists. ${full}`;
                case 422:
                    return `Error: GitHub validation failed. ${full}`;
                case 429:
                    return "Error: GitHub rate limit exceeded. Wait before retrying.";
                default:
                    return `Error: GitHub API returned HTTP ${status}. ${full}`;
            }
        }
        if (axErr.code === "ECONNABORTED") {
            return "Error: GitHub API request timed out.";
        }
    }
    return `Error: Unexpected GitHub error — ${error instanceof Error ? error.message : String(error)}`;
}
/** Check if GitHub API is configured */
export function isGithubConfigured() {
    return !!process.env.GITHUB_TOKEN;
}
//# sourceMappingURL=github-client.js.map