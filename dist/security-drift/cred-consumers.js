// Loader for per-repo `.cred-consumers.toml` files — the WS-0.7 consumer inventory
// that gates rotation (a credential whose consumer set is not attested here is
// NEVER auto-revoked).
//
// STRICT SUBSET TOML parser, deliberately not a third-party dependency: this feeds
// the 4am no-LLM write path, so the parsing surface stays minimal and fully
// unit-tested. Supported syntax: comments/blank lines, `key = value` (string,
// integer, boolean, array-of-strings), [[credential]] and
// [[credential.consumer]] / [[credential.exposure]] tables. Anything else throws
// CredConsumersParseError — deny-by-default: a malformed file yields NO
// rotation-eligible credentials, never a guessed one.
import * as fs from 'node:fs';
export class CredConsumersParseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CredConsumersParseError';
    }
}
function parseValue(raw, line) {
    const v = raw.trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
        const inner = v.slice(1, -1);
        if (inner.includes('"'))
            throw new CredConsumersParseError(`line ${line}: embedded quote in string`);
        return inner;
    }
    if (v === 'true')
        return true;
    if (v === 'false')
        return false;
    if (/^-?\d+$/.test(v))
        return Number.parseInt(v, 10);
    if (v.startsWith('[') && v.endsWith(']')) {
        const body = v.slice(1, -1).trim();
        if (!body)
            return [];
        return body.split(',').map((part) => {
            const p = part.trim();
            if (!(p.startsWith('"') && p.endsWith('"') && p.length >= 2)) {
                throw new CredConsumersParseError(`line ${line}: arrays may contain only quoted strings`);
            }
            return p.slice(1, -1);
        });
    }
    throw new CredConsumersParseError(`line ${line}: unsupported value syntax: ${v.slice(0, 40)}`);
}
/**
 * Strip a trailing comment from a line, respecting quoted strings and arrays of
 * quoted strings (the only string-bearing forms the subset allows).
 */
function stripComment(line) {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"')
            inString = !inString;
        else if (ch === '#' && !inString)
            return line.slice(0, i);
    }
    return line;
}
/** Parse one .cred-consumers.toml document. Throws CredConsumersParseError on any deviation. */
export function parseCredConsumers(text) {
    const creds = [];
    let cred = null;
    let sub = null;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const n = i + 1;
        const line = stripComment(lines[i]).trim();
        if (!line)
            continue;
        if (line === '[[credential]]') {
            cred = { id: '', class: '', rotation_preconditions: [], consumers: [], exposures: [] };
            creds.push(cred);
            sub = null;
            continue;
        }
        if (line === '[[credential.consumer]]' || line === '[[credential.exposure]]') {
            if (!cred)
                throw new CredConsumersParseError(`line ${n}: ${line} before any [[credential]]`);
            if (line === '[[credential.consumer]]') {
                sub = { kind: '' };
                cred.consumers.push(sub);
            }
            else {
                sub = { id: '', date: '' };
                cred.exposures.push(sub);
            }
            continue;
        }
        if (line.startsWith('['))
            throw new CredConsumersParseError(`line ${n}: unsupported table ${line}`);
        const eq = line.indexOf('=');
        if (eq < 1)
            throw new CredConsumersParseError(`line ${n}: expected key = value`);
        const key = line.slice(0, eq).trim();
        if (!/^[A-Za-z0-9_-]+$/.test(key))
            throw new CredConsumersParseError(`line ${n}: bad key ${key}`);
        const value = parseValue(line.slice(eq + 1), n);
        if (sub) {
            sub[key] = value;
        }
        else if (cred) {
            cred[key] = value;
        }
        else if (key === 'version') {
            if (value !== 1)
                throw new CredConsumersParseError(`unsupported version ${String(value)}`);
        }
        else {
            throw new CredConsumersParseError(`line ${n}: top-level key ${key} outside any table`);
        }
    }
    for (const c of creds) {
        if (typeof c.id !== 'string' || typeof c.class !== 'string' || !c.id || !c.class) {
            throw new CredConsumersParseError(`credential missing string id/class (id=${String(c.id) || '?'})`);
        }
        for (const consumer of c.consumers) {
            if (!consumer.kind)
                throw new CredConsumersParseError(`credential ${c.id}: consumer missing kind`);
        }
        for (const exposure of c.exposures) {
            if (!exposure.id || !exposure.date)
                throw new CredConsumersParseError(`credential ${c.id}: exposure missing id/date`);
        }
    }
    const ids = new Set();
    for (const c of creds) {
        if (ids.has(c.id))
            throw new CredConsumersParseError(`duplicate credential id ${c.id}`);
        ids.add(c.id);
    }
    return creds;
}
/**
 * Load every listed .cred-consumers.toml. A missing list file or empty list means
 * NO managed credentials (deny-by-default) — rotation detection simply emits nothing.
 * A listed-but-unreadable/unparseable file throws (the caller escalates, never guesses).
 */
export function loadCredConsumerFiles(files) {
    const all = [];
    const ids = new Set();
    for (const file of files) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        }
        catch (e) {
            throw new CredConsumersParseError(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
        for (const cred of parseCredConsumers(text)) {
            if (ids.has(cred.id))
                throw new CredConsumersParseError(`duplicate credential id ${cred.id} across files (${file})`);
            ids.add(cred.id);
            all.push(cred);
        }
    }
    return all;
}
//# sourceMappingURL=cred-consumers.js.map