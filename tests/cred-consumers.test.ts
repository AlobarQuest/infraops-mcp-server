import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseCredConsumers,
  loadCredConsumerFiles,
  CredConsumersParseError,
} from '../src/security-drift/cred-consumers.js';

describe('parseCredConsumers', () => {
  it('parses a realistic document with all field kinds', () => {
    const doc = `
version = 1

[[credential]]
id = "gh-pat-alobar"
class = "github-pat-classic"
fingerprint_sha256_8 = "abcd1234"
provider = "github"
provider_identity = "AlobarQuest"
bws_uuid = "b1-uuid" # trailing comment stripped
consumers_verified = "2026-06-01"
verified_by = "Devon"
disposition = "reissue"
replacement_scope = "repo:read"
created = "2025-01-01"
last_rotated = "2025-06-01"
rotation_preconditions = ["fix x"]

[[credential.consumer]]
kind = "bws-secret"
uuid = "consumer-uuid-1"

[[credential.consumer]]
kind = "keychain"
service = "cred-rotation"
account = "gh-pat-alobar"

[[credential.consumer]]
kind = "coolify-env"
instance = "prod"
resource_type = "application"
uuid = "app-uuid-1"
key = "GH_TOKEN"
redeploy = true

[[credential.exposure]]
id = "exp-1"
date = "2026-05-01"
source = "leaked in commit # not a comment, quoted"

[[credential]]
id = "openrouter-main"
class = "openrouter-key"
bws_uuid = "b2-uuid"
consumers_verified = "2026-06-01"
disposition = "reissue"

[[credential.consumer]]
kind = "bws-secret"
uuid = "consumer-uuid-2"
`;
    const creds = parseCredConsumers(doc);
    expect(creds).toHaveLength(2);

    const gh = creds[0];
    expect(gh.id).toBe('gh-pat-alobar');
    expect(gh.class).toBe('github-pat-classic');
    expect(gh.fingerprint_sha256_8).toBe('abcd1234');
    expect(gh.provider).toBe('github');
    expect(gh.provider_identity).toBe('AlobarQuest');
    expect(gh.bws_uuid).toBe('b1-uuid');
    expect(gh.consumers_verified).toBe('2026-06-01');
    expect(gh.verified_by).toBe('Devon');
    expect(gh.disposition).toBe('reissue');
    expect(gh.replacement_scope).toBe('repo:read');
    expect(gh.created).toBe('2025-01-01');
    expect(gh.last_rotated).toBe('2025-06-01');
    expect(gh.rotation_preconditions).toEqual(['fix x']);

    expect(gh.consumers).toHaveLength(3);
    expect(gh.consumers[0]).toMatchObject({ kind: 'bws-secret', uuid: 'consumer-uuid-1' });
    expect(gh.consumers[1]).toMatchObject({
      kind: 'keychain',
      service: 'cred-rotation',
      account: 'gh-pat-alobar',
    });
    expect(gh.consumers[2]).toMatchObject({
      kind: 'coolify-env',
      instance: 'prod',
      resource_type: 'application',
      uuid: 'app-uuid-1',
      key: 'GH_TOKEN',
      redeploy: true,
    });
    expect(gh.consumers[2].redeploy).toBe(true);

    expect(gh.exposures).toHaveLength(1);
    expect(gh.exposures[0]).toEqual({
      id: 'exp-1',
      date: '2026-05-01',
      source: 'leaked in commit # not a comment, quoted',
    });

    const or = creds[1];
    expect(or.id).toBe('openrouter-main');
    expect(or.class).toBe('openrouter-key');
    expect(or.rotation_preconditions).toEqual([]);
    expect(or.consumers).toHaveLength(1);
    expect(or.exposures).toHaveLength(0);
  });

  it('strips inline # comments but preserves # inside quoted strings', () => {
    const doc = `
version = 1
[[credential]]
id = "x"
class = "openai-key"
provider = "openai" # this is a comment
note = "value" # after
`;
    const creds = parseCredConsumers(doc);
    expect(creds[0].provider).toBe('openai');
  });

  it('throws on unsupported bare-word value syntax', () => {
    const doc = `
version = 1
[[credential]]
id = "x"
class = bareword
`;
    expect(() => parseCredConsumers(doc)).toThrow(CredConsumersParseError);
  });

  it('throws on unknown table header [credential] (missing double brackets)', () => {
    const doc = `
version = 1
[credential]
id = "x"
`;
    expect(() => parseCredConsumers(doc)).toThrow(CredConsumersParseError);
  });

  it('throws when [[credential.consumer]] appears before any [[credential]]', () => {
    const doc = `
version = 1
[[credential.consumer]]
kind = "bws-secret"
`;
    expect(() => parseCredConsumers(doc)).toThrow(CredConsumersParseError);
  });

  it('throws when a credential is missing id', () => {
    const doc = `
version = 1
[[credential]]
class = "openai-key"
`;
    expect(() => parseCredConsumers(doc)).toThrow(CredConsumersParseError);
  });

  it('throws when a credential is missing class', () => {
    const doc = `
version = 1
[[credential]]
id = "x"
`;
    expect(() => parseCredConsumers(doc)).toThrow(CredConsumersParseError);
  });

  it('throws when a consumer is missing kind', () => {
    const doc = `
version = 1
[[credential]]
id = "x"
class = "openai-key"

[[credential.consumer]]
uuid = "u1"
`;
    expect(() => parseCredConsumers(doc)).toThrow(CredConsumersParseError);
  });

  it('throws when an exposure is missing id or date', () => {
    const doc = `
version = 1
[[credential]]
id = "x"
class = "openai-key"

[[credential.exposure]]
date = "2026-01-01"
`;
    expect(() => parseCredConsumers(doc)).toThrow(CredConsumersParseError);

    const doc2 = `
version = 1
[[credential]]
id = "x"
class = "openai-key"

[[credential.exposure]]
id = "e1"
`;
    expect(() => parseCredConsumers(doc2)).toThrow(CredConsumersParseError);
  });

  it('throws on duplicate credential ids within one document', () => {
    const doc = `
version = 1
[[credential]]
id = "dup"
class = "openai-key"

[[credential]]
id = "dup"
class = "openrouter-key"
`;
    expect(() => parseCredConsumers(doc)).toThrow(CredConsumersParseError);
  });

  it('throws on a top-level key other than version outside any table', () => {
    const doc = `
version = 1
random_key = "val-A"
`;
    expect(() => parseCredConsumers(doc)).toThrow(CredConsumersParseError);
  });

  it('throws when version != 1', () => {
    expect(() => parseCredConsumers('version = 2\n')).toThrow(CredConsumersParseError);
    expect(() => parseCredConsumers('version = "1"\n')).toThrow(CredConsumersParseError);
  });
});

describe('loadCredConsumerFiles', () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads and concatenates two files from a directory', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-consumers-'));
    const fileA = path.join(dir, 'a.toml');
    const fileB = path.join(dir, 'b.toml');
    fs.writeFileSync(
      fileA,
      `
version = 1
[[credential]]
id = "cred-a"
class = "openai-key"
`,
    );
    fs.writeFileSync(
      fileB,
      `
version = 1
[[credential]]
id = "cred-b"
class = "openrouter-key"
`,
    );
    const all = loadCredConsumerFiles([fileA, fileB]);
    expect(all.map((c) => c.id).sort()).toEqual(['cred-a', 'cred-b']);
  });

  it('throws when a listed file is missing', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-consumers-'));
    expect(() => loadCredConsumerFiles([path.join(dir, 'nope.toml')])).toThrow(
      CredConsumersParseError,
    );
  });

  it('throws on duplicate credential id across files', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-consumers-'));
    const fileA = path.join(dir, 'a.toml');
    const fileB = path.join(dir, 'b.toml');
    fs.writeFileSync(
      fileA,
      `
version = 1
[[credential]]
id = "cred-shared"
class = "openai-key"
`,
    );
    fs.writeFileSync(
      fileB,
      `
version = 1
[[credential]]
id = "cred-shared"
class = "openrouter-key"
`,
    );
    expect(() => loadCredConsumerFiles([fileA, fileB])).toThrow(CredConsumersParseError);
  });

  it('returns an empty array for an empty file list', () => {
    expect(loadCredConsumerFiles([])).toEqual([]);
  });
});
