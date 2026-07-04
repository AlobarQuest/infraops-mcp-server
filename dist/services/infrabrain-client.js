import axios from 'axios';
import { REQUEST_TIMEOUT } from '../constants.js';
let _client = null;
function getClient() {
    if (_client)
        return _client;
    const baseURL = process.env.INFRABRAIN_BASE_URL;
    const key = process.env.INFRABRAIN_ACCESS_KEY;
    if (!baseURL || !key) {
        throw new Error('infra-brain is not configured. Set INFRABRAIN_BASE_URL and INFRABRAIN_ACCESS_KEY.');
    }
    _client = axios.create({
        baseURL,
        timeout: REQUEST_TIMEOUT,
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-brain-key': key,
        },
    });
    return _client;
}
export async function infrabrainGet(endpoint, params) {
    const client = getClient();
    const response = await client.get(endpoint, { params });
    return response.data;
}
export function handleInfrabrainError(error) {
    if (axios.isAxiosError(error)) {
        const axErr = error;
        if (axErr.response) {
            const status = axErr.response.status;
            const body = axErr.response.data;
            const msg = body?.detail ?? body?.message ?? JSON.stringify(body);
            switch (status) {
                case 401:
                    return ('Error: infra-brain authentication failed (HTTP 401). ' +
                        "Check INFRABRAIN_ACCESS_KEY matches the server's MCP_ACCESS_KEY.");
                case 403:
                    return `Error: infra-brain permission denied. ${msg}`;
                case 404:
                    return `Error: infra-brain resource not found. ${msg}`;
                case 429:
                    return 'Error: infra-brain rate limit exceeded. Wait before retrying.';
                case 503:
                    return `Error: infra-brain service unavailable. Try again in a moment.`;
                default:
                    return `Error: infra-brain API returned HTTP ${status}. ${msg}`;
            }
        }
        if (axErr.code === 'ECONNABORTED') {
            return 'Error: infra-brain request timeout.';
        }
        return `Error: infra-brain network error — ${axErr.message}`;
    }
    return `Error: Unexpected infra-brain error — ${error instanceof Error ? error.message : String(error)}`;
}
export function isInfrabrainConfigured() {
    return !!(process.env.INFRABRAIN_BASE_URL && process.env.INFRABRAIN_ACCESS_KEY);
}
//# sourceMappingURL=infrabrain-client.js.map