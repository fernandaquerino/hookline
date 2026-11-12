import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from './app-config';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  HOOKLINE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SESSION_SECRET: 'a-session-secret-long-enough',
  ADMIN_PASSWORD_HASH: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
};

describe('loadAppConfig', () => {
  it('applies defaults', () => {
    const config = loadAppConfig({ ...base });
    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('development');
    expect(config.allowPrivateDestinations).toBe(true);
    expect(config.redactHeaders).toEqual([]);
    expect(config.maxBodyBytes).toBe(262_144);
  });

  it('fails closed on private destinations outside development', () => {
    expect(loadAppConfig({ ...base, NODE_ENV: 'production' }).allowPrivateDestinations).toBe(false);
  });

  it('parses REDACT_HEADERS and trims the public URL', () => {
    const config = loadAppConfig({
      ...base,
      REDACT_HEADERS: 'X-Api-Key, X-Token',
      PUBLIC_INGEST_BASE_URL: 'https://hooks.example.test/',
    });
    expect(config.redactHeaders).toEqual(['x-api-key', 'x-token']);
    expect(config.publicIngestBaseUrl).toBe('https://hooks.example.test');
  });

  it('lists every invalid variable', () => {
    expect(() => loadAppConfig({ SESSION_SECRET: 'short' })).toThrow(
      /DATABASE_URL[\s\S]*HOOKLINE_ENCRYPTION_KEY[\s\S]*ADMIN_PASSWORD_HASH[\s\S]*SESSION_SECRET/,
    );
  });

  it('requires a generated admin password hash', () => {
    expect(() => loadAppConfig({ ...base, ADMIN_PASSWORD_HASH: 'plain-password' })).toThrow(
      /hash-password/,
    );
  });

  it('rejects an encryption key of the wrong length', () => {
    expect(() => loadAppConfig({ ...base, HOOKLINE_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /32 bytes/,
    );
  });
});
