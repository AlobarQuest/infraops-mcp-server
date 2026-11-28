import { describe, it, expect } from 'vitest';
import { isSecretName, redactText, deepRedact } from '../src/utils/redaction.js';

const PEM =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----';

// BWS token fixtures are assembled at runtime so no tracked file holds the full shape.
const UUID = ['1b2c3d4e', '5f60', '4a7b', '8c9d', '0e1f2a3b4c5d'].join('-');
const BWS_TOKEN = ['0', UUID, 'Ab1+/=:_-'.repeat(4)].join('.');

describe('isSecretName', () => {
  it('flags secret-bearing names', () => {
    for (const k of [
      'private_key',
      'privatekey',
      'privateKey',
      'postgres_password',
      'redis_password',
      'root_password',
      'manual_webhook_secret_github',
      'http_basic_auth_password',
      'client_secret',
      'tunnel_secret',
      'jwt_secret',
      'credentials',
      'authorization',
      'access_token',
    ]) {
      expect(isSecretName(k)).toBe(true);
    }
  });
  it('preserves guarded / non-secret names', () => {
    for (const k of [
      'public_key',
      'publickey',
      'key_name',
      'private_key_id',
      'private_key_uuid',
      'application_id',
      'deployment_uuid',
      'fingerprint',
      'database_url',
      'created_at',
      'application_name',
      'status',
      'commit',
      'port',
      'region',
    ]) {
      expect(isSecretName(k)).toBe(false);
    }
  });
});

describe('redactText (value-shape)', () => {
  it('redacts a PEM private key block', () => {
    expect(redactText(`key is ${PEM} end`)).not.toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(redactText(`key is ${PEM} end`)).toContain('***');
  });
  it('redacts a truncated PEM head (no END)', () => {
    const head = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA';
    expect(redactText(head)).not.toContain('MIIEpAIBAAKCAQEA');
  });
  it('over-redacts to end-of-string when a truncated PEM is mid-string (err-safe, by design)', () => {
    // A truncated PEM with no END block consumes everything after it. This is
    // intentional over-redaction: a future maintainer must not "fix" this into a leak.
    const out = redactText('key: -----BEGIN RSA PRIVATE KEY-----\nMIIEpA\nother field data: 42');
    expect(out).not.toContain('MIIEpA');
    expect(out).not.toContain('other field data: 42');
    expect(out).toContain('***');
  });
  it('redacts a JWT (Supabase service_role shape)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiI.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abc-_123';
    expect(redactText(`token=${jwt}`)).not.toContain(jwt);
  });
  it('redacts known token prefixes', () => {
    expect(redactText('ghp_0123456789abcdef0123456789abcdef0123')).toContain('***');
    expect(redactText('sk-ant-api03-abcdefghijklmnopqrstuvwx')).toContain('***');
  });
  it('redacts only the password in a connection URL', () => {
    const out = redactText('postgres://app:s3cr3tPw@db-host:5432/mydb');
    expect(out).toContain('postgres://app:***@db-host:5432/mydb');
    expect(out).not.toContain('s3cr3tPw');
  });
  it('masks a whole BWS access token', () => {
    expect(redactText(`token is ${BWS_TOKEN} here`)).toBe('token is *** here');
  });
  it('masks a BWS token in a rendered compose and leaves the other lines unchanged', () => {
    const lines = [
      'services:',
      '  lane:',
      '    image: ghcr.io/alobarquest/lane:1.2.3',
      '    environment:',
      '      LANE_NAME: lane-a',
      `      BWS_SECRET_FOR_LANE: ${BWS_TOKEN}`,
      '      PORT: 8000',
    ];
    const out = redactText(lines.join('\n')).split('\n');
    expect(out[5]).toBe('      BWS_SECRET_FOR_LANE: ***');
    expect(out.filter((_, i) => i !== 5)).toEqual(lines.filter((_, i) => i !== 5));
  });
  it('leaves a bare UUID and a 0.-prefixed UUID with no secret part alone', () => {
    expect(redactText(UUID)).toBe(UUID);
    const noSecret = ['0', UUID].join('.');
    expect(redactText(noSecret)).toBe(noSecret);
    const shortSecret = ['0', UUID, 'A'.repeat(19)].join('.');
    expect(redactText(shortSecret)).toBe(shortSecret);
  });
  it('leaves ssh public keys and ordinary text alone', () => {
    const pub = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID example@host';
    expect(redactText(pub)).toBe(pub);
    expect(redactText('just a normal sentence with an id 12345')).toBe(
      'just a normal sentence with an id 12345',
    );
  });
});

describe('deepRedact', () => {
  it('masks the Porkbun SSL bundle privatekey by name, not publickey', () => {
    const out: any = deepRedact({
      status: 'SUCCESS',
      certificatechain: 'chain',
      privatekey: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', // base64 body without PEM armour
      publickey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOC',
    });
    expect(out.privatekey).toBe('***');
    expect(out.publickey).toBe('MIIBIjANBgkqhkiG9w0BAQEFAAOC');
    expect(out.certificatechain).toBe('chain');
  });

  it('masks authorization at any depth without touching unrelated fields', () => {
    const out: any = deepRedact({
      authorization: 'Basic dXNlcjpwdw==',
      wp: { authorization: 'Basic dXNlcjpwdw==', restUrl: 'https://d.com/wp-json/' },
      role: 'editor',
    });
    expect(out.authorization).toBe('***');
    expect(out.wp.authorization).toBe('***');
    expect(out.wp.restUrl).toBe('https://d.com/wp-json/');
    expect(out.role).toBe('editor');
  });

  it('masks secret-named fields, preserves null and guarded fields', () => {
    const out: any = deepRedact({
      private_key: PEM,
      private_key_id: 7,
      public_key: 'ssh-ed25519 AAAA...',
      postgres_password: 'p4ss',
      manual_webhook_secret_github: 'whsec',
      no_secret_here: null,
      status: 'finished',
      application_name: 'booking',
    });
    expect(out.private_key).toBe('***');
    expect(out.postgres_password).toBe('***');
    expect(out.manual_webhook_secret_github).toBe('***');
    expect(out.private_key_id).toBe(7);
    expect(out.public_key).toBe('ssh-ed25519 AAAA...');
    expect(out.no_secret_here).toBeNull();
    expect(out.status).toBe('finished');
    expect(out.application_name).toBe('booking');
  });
  it('recurses nested objects and arrays (eager-loaded relations)', () => {
    const out: any = deepRedact({
      application: { source: { private_key: PEM } },
      rows: [{ db_password: 'x' }],
    });
    expect(out.application.source.private_key).toBe('***');
    expect(out.rows[0].db_password).toBe('***');
  });
  it('value-shape redacts a secret in a non-secret-named string field', () => {
    const out: any = deepRedact({ note: `cloned with ${PEM}`, api_key: 'eyJhbGciOi.eyJ.sig-_1' });
    expect(out.note).not.toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(out.api_key).toBe('***');
  });
  it('value-shape masks a BWS token under a non-secret-named field', () => {
    const out: any = deepRedact({ docker_compose: `env: ${BWS_TOKEN}`, note: BWS_TOKEN });
    expect(out.docker_compose).toBe('env: ***');
    expect(out.note).toBe('***');
  });
  it('is non-mutating', () => {
    const input = { private_key: 'x' };
    deepRedact(input);
    expect(input.private_key).toBe('x');
  });
});
