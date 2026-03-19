/**
 * Hetzner Cloud API client.
 *
 * Wraps the Hetzner Cloud REST API at https://api.hetzner.cloud/v1.
 * Used for cloud-level management: servers, firewalls, SSH keys, volumes,
 * snapshots, networks, floating IPs.
 */
import axios from "axios";
import { REQUEST_TIMEOUT } from "../constants.js";
const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";
// ── Singleton client ─────────────────────────────────────────────────
let _client = null;
function getClient() {
    if (_client)
        return _client;
    const token = process.env.HETZNER_API_TOKEN;
    if (!token) {
        throw new Error("HETZNER_API_TOKEN environment variable is required. " +
            "Generate one in Hetzner Cloud Console → Project → Security → API Tokens. " +
            "Store it in BWS and set BWS_HETZNER_SECRET_ID in your MCP config.");
    }
    _client = axios.create({
        baseURL: HETZNER_API_BASE,
        timeout: REQUEST_TIMEOUT,
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
        },
    });
    return _client;
}
// ── Public helpers ───────────────────────────────────────────────────
export async function hetznerGet(endpoint, params) {
    const client = getClient();
    const response = await client.get(endpoint, { params });
    return response.data;
}
export async function hetznerPost(endpoint, data) {
    const client = getClient();
    const response = await client.post(endpoint, data);
    return response.data;
}
export async function hetznerPut(endpoint, data) {
    const client = getClient();
    const response = await client.put(endpoint, data);
    return response.data;
}
export async function hetznerDelete(endpoint) {
    const client = getClient();
    const response = await client.delete(endpoint);
    return response.data;
}
// ── Error handler ────────────────────────────────────────────────────
export function handleHetznerError(error) {
    if (axios.isAxiosError(error)) {
        const axErr = error;
        if (axErr.response) {
            const status = axErr.response.status;
            const body = axErr.response.data;
            const msg = body?.error?.message ?? JSON.stringify(body);
            const code = body?.error?.code ?? "";
            switch (status) {
                case 401:
                    return ("Error: Hetzner authentication failed. Your HETZNER_API_TOKEN may be invalid or expired. " +
                        "Regenerate it in Hetzner Cloud Console → Security → API Tokens.");
                case 403:
                    return `Error: Hetzner permission denied. ${msg}`;
                case 404:
                    return `Error: Hetzner resource not found. ${msg}`;
                case 409:
                    return `Error: Hetzner conflict — ${code}: ${msg}`;
                case 422:
                    return `Error: Hetzner validation failed. ${msg}`;
                case 429:
                    return "Error: Hetzner rate limit exceeded. Wait before retrying.";
                case 503:
                    return `Error: Hetzner service unavailable. Try again in a moment.`;
                default:
                    return `Error: Hetzner API returned HTTP ${status}. ${msg}`;
            }
        }
        if (axErr.code === "ECONNABORTED") {
            return "Error: Hetzner API request timed out.";
        }
    }
    return `Error: Unexpected Hetzner error — ${error instanceof Error ? error.message : String(error)}`;
}
/** Check if Hetzner API is configured */
export function isHetznerConfigured() {
    return !!process.env.HETZNER_API_TOKEN;
}
//# sourceMappingURL=hetzner-client.js.map