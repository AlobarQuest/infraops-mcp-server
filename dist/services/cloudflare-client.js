/**
 * Cloudflare API client.
 *
 * Wraps the Cloudflare REST API at https://api.cloudflare.com/client/v4.
 * Used for DNS, Pages, Workers, R2, Tunnels, WAF, and SSL management.
 */
import axios from "axios";
import { REQUEST_TIMEOUT } from "../constants.js";
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
// ── Singleton client ─────────────────────────────────────────────────
let _client = null;
function getClient() {
    if (_client)
        return _client;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
        throw new Error("CLOUDFLARE_API_TOKEN environment variable is required. " +
            "Create a scoped API token at https://dash.cloudflare.com/profile/api-tokens. " +
            "Store it in BWS and set BWS_CLOUDFLARE_SECRET_ID in your MCP config.");
    }
    _client = axios.create({
        baseURL: CLOUDFLARE_API_BASE,
        timeout: REQUEST_TIMEOUT,
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
        },
    });
    return _client;
}
/** Get the configured Cloudflare account ID */
export function getAccountId() {
    const id = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!id) {
        throw new Error("CLOUDFLARE_ACCOUNT_ID environment variable is required. " +
            "Find it at https://dash.cloudflare.com → any zone → Overview → right sidebar.");
    }
    return id;
}
// ── Public helpers ───────────────────────────────────────────────────
export async function cloudflareGet(endpoint, params) {
    const client = getClient();
    const response = await client.get(endpoint, { params });
    return response.data;
}
export async function cloudflarePost(endpoint, data) {
    const client = getClient();
    const response = await client.post(endpoint, data);
    return response.data;
}
export async function cloudflarePut(endpoint, data) {
    const client = getClient();
    const response = await client.put(endpoint, data);
    return response.data;
}
export async function cloudflarePatch(endpoint, data) {
    const client = getClient();
    const response = await client.patch(endpoint, data);
    return response.data;
}
export async function cloudflareDelete(endpoint) {
    const client = getClient();
    const response = await client.delete(endpoint);
    return response.data;
}
export function handleCloudflareError(error) {
    if (axios.isAxiosError(error)) {
        const axErr = error;
        if (axErr.response) {
            const status = axErr.response.status;
            const body = axErr.response.data;
            const cfErrors = body?.errors;
            const msg = cfErrors?.length
                ? cfErrors.map((e) => `[${e.code}] ${e.message}`).join("; ")
                : JSON.stringify(body);
            switch (status) {
                case 400:
                    return `Error: Cloudflare bad request. ${msg}`;
                case 401:
                    return ("Error: Cloudflare authentication failed. Your CLOUDFLARE_API_TOKEN may be invalid or expired. " +
                        "Regenerate it at https://dash.cloudflare.com/profile/api-tokens.");
                case 403:
                    return `Error: Cloudflare permission denied. Your API token may lack the required scope. ${msg}`;
                case 404:
                    return `Error: Cloudflare resource not found. ${msg}`;
                case 409:
                    return `Error: Cloudflare conflict. ${msg}`;
                case 422:
                    return `Error: Cloudflare validation failed. ${msg}`;
                case 429:
                    return "Error: Cloudflare rate limit exceeded (1,200 req / 5 min). Wait before retrying.";
                default:
                    return `Error: Cloudflare API returned HTTP ${status}. ${msg}`;
            }
        }
        if (axErr.code === "ECONNABORTED") {
            return "Error: Cloudflare API request timed out.";
        }
    }
    return `Error: Unexpected Cloudflare error — ${error instanceof Error ? error.message : String(error)}`;
}
/** Check if Cloudflare API is configured */
export function isCloudflareConfigured() {
    return !!process.env.CLOUDFLARE_API_TOKEN && !!process.env.CLOUDFLARE_ACCOUNT_ID;
}
//# sourceMappingURL=cloudflare-client.js.map