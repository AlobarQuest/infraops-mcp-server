/**
 * Namecheap API client.
 *
 * Wraps the Namecheap XML API for domain and DNS management.
 * Supports both sandbox and production environments via NAMECHEAP_USE_SANDBOX.
 *
 * Namecheap API specifics:
 *   - All requests are GET with query parameters (despite being mutations)
 *   - Responses are XML, parsed to JS objects
 *   - Auth is via ApiUser + ApiKey + ClientIp query params on every request
 *   - Commands use dot notation: namecheap.domains.getList, etc.
 */
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { REQUEST_TIMEOUT } from '../constants.js';
// ── API base URLs ────────────────────────────────────────────────────
const NAMECHEAP_SANDBOX_URL = 'https://namecheap-proxy.devonwatkins.com/sandbox/xml.response';
const NAMECHEAP_PRODUCTION_URL = 'https://namecheap-proxy.devonwatkins.com/prod/xml.response';
// ── XML parser (shared instance) ─────────────────────────────────────
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '_text',
    parseAttributeValue: true,
    isArray: (name) => {
        // These elements should always be arrays even when there's only one result
        const arrayNodes = [
            'DomainDNSGetHostsResult.host',
            'host',
            'Tld',
            'DomainCheckResult',
            'Transfer',
        ];
        return arrayNodes.includes(name);
    },
});
const VPS_IP = '178.156.247.239';
function getConfig() {
    const apiUser = process.env.NAMECHEAP_API_USER;
    const apiKey = process.env.NAMECHEAP_API_KEY;
    const proxyToken = process.env.NAMECHEAP_PROXY_TOKEN;
    if (!apiUser || !apiKey || !proxyToken) {
        throw new Error('Namecheap API requires NAMECHEAP_API_USER, NAMECHEAP_API_KEY, and NAMECHEAP_PROXY_TOKEN. ' +
            'Store credentials in BWS.');
    }
    const useSandbox = (process.env.NAMECHEAP_USE_SANDBOX ?? 'true').toLowerCase() === 'true';
    return {
        apiUser,
        apiKey,
        userName: process.env.NAMECHEAP_USERNAME ?? apiUser,
        useSandbox,
        proxyToken,
    };
}
// ── Singleton client ─────────────────────────────────────────────────
let _client = null;
let _config = null;
function getClient() {
    if (_client && _config)
        return { client: _client, config: _config };
    _config = getConfig();
    const baseURL = _config.useSandbox ? NAMECHEAP_SANDBOX_URL : NAMECHEAP_PRODUCTION_URL;
    _client = axios.create({
        baseURL,
        timeout: REQUEST_TIMEOUT,
        headers: {
            Accept: 'application/xml',
            Authorization: `Bearer ${_config.proxyToken}`,
        },
        // Don't throw on non-2xx — we parse errors from XML
        validateStatus: () => true,
    });
    return { client: _client, config: _config };
}
// ── Core request function ─────────────────────────────────────────────
/**
 * Execute a Namecheap API command.
 *
 * All Namecheap API calls use GET with query parameters.
 * The response is XML which we parse to a JS object.
 */
export async function namecheapCommand(command, params = {}) {
    const { client, config } = getClient();
    const queryParams = {
        ApiUser: config.apiUser,
        ApiKey: config.apiKey,
        UserName: config.userName,
        ClientIp: VPS_IP,
        Command: command,
        ...params,
    };
    const response = await client.get('', { params: queryParams });
    const xmlData = response.data;
    // Parse XML response
    const parsed = xmlParser.parse(xmlData);
    const apiResponse = parsed.ApiResponse;
    if (!apiResponse) {
        throw new Error('Invalid Namecheap API response — missing ApiResponse root element');
    }
    const result = {
        Status: apiResponse.Status,
        Errors: apiResponse.Errors,
        CommandResponse: apiResponse.CommandResponse ?? {},
        Server: apiResponse.Server ?? '',
        GMTTimeDifference: apiResponse.GMTTimeDifference ?? '',
        ExecutionTime: apiResponse.ExecutionTime ?? 0,
    };
    // Check for API-level errors
    if (result.Status === 'ERROR') {
        const errors = result.Errors?.Error;
        if (errors) {
            const errArray = Array.isArray(errors) ? errors : [errors];
            const messages = errArray.map((e) => `[${e.Number}] ${e._text}`).join('; ');
            throw new NamecheapApiError(messages, errArray[0]?.Number);
        }
        throw new NamecheapApiError('Unknown Namecheap API error');
    }
    return result;
}
// ── Error classes ─────────────────────────────────────────────────────
export class NamecheapApiError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'NamecheapApiError';
        this.code = code;
    }
}
// ── Error handler (matches Hetzner/Coolify pattern) ──────────────────
export function handleNamecheapError(error) {
    if (error instanceof NamecheapApiError) {
        const code = error.code;
        // Common Namecheap error codes
        if (code === 2019166)
            return `Error: Namecheap domain not found. ${error.message}`;
        if (code === 2016166)
            return `Error: Namecheap domain unavailable for registration. ${error.message}`;
        if (code === 2030166)
            return `Error: Namecheap edit lock is on. Unlock the domain first. ${error.message}`;
        if (code === 2011166)
            return `Error: Namecheap authentication failed. Check your API credentials. ${error.message}`;
        if (code === 2011170)
            return `Error: Namecheap IP not whitelisted. Add ${VPS_IP} to your API access list.`;
        if (code && code >= 5000000)
            return `Error: Namecheap server error. Try again in a moment. ${error.message}`;
        return `Error: Namecheap API — ${error.message}`;
    }
    if (axios.isAxiosError(error)) {
        const axErr = error;
        if (axErr.code === 'ECONNABORTED') {
            return 'Error: Namecheap API request timed out.';
        }
        if (axErr.response) {
            return `Error: Namecheap HTTP ${axErr.response.status}. The API may be down.`;
        }
        if (axErr.code === 'ENOTFOUND') {
            return 'Error: Cannot reach Namecheap API. Check your network connection.';
        }
    }
    return `Error: Unexpected Namecheap error — ${error instanceof Error ? error.message : String(error)}`;
}
// ── Config check ──────────────────────────────────────────────────────
/** Check if Namecheap API is configured */
export function isNamecheapConfigured() {
    return !!(process.env.NAMECHEAP_API_USER &&
        process.env.NAMECHEAP_API_KEY &&
        process.env.NAMECHEAP_PROXY_TOKEN);
}
/** Get current environment label */
export function getNamecheapEnvironment() {
    if (!isNamecheapConfigured())
        return 'not configured';
    const sandbox = (process.env.NAMECHEAP_USE_SANDBOX ?? 'true').toLowerCase() === 'true';
    return sandbox ? 'sandbox' : 'production';
}
// ── Convenience helpers ──────────────────────────────────────────────
/**
 * Split a domain string into SLD and TLD.
 * e.g. "example.com" → { sld: "example", tld: "com" }
 * e.g. "sub.example.co.uk" → { sld: "sub.example", tld: "co.uk" }
 */
export function splitDomain(domain) {
    // Handle common multi-part TLDs
    const multiPartTlds = [
        'co.uk',
        'co.nz',
        'co.za',
        'co.in',
        'co.jp',
        'co.kr',
        'com.au',
        'com.br',
        'com.cn',
        'com.mx',
        'com.sg',
        'net.au',
        'net.nz',
        'org.au',
        'org.uk',
        'org.nz',
        'me.uk',
        'ac.uk',
    ];
    const lower = domain.toLowerCase();
    for (const mpt of multiPartTlds) {
        if (lower.endsWith(`.${mpt}`)) {
            const sld = domain.slice(0, -(mpt.length + 1));
            return { sld, tld: mpt };
        }
    }
    const lastDot = domain.lastIndexOf('.');
    if (lastDot === -1) {
        throw new Error(`Invalid domain: "${domain}" — no TLD found`);
    }
    return {
        sld: domain.slice(0, lastDot),
        tld: domain.slice(lastDot + 1),
    };
}
//# sourceMappingURL=namecheap-client.js.map