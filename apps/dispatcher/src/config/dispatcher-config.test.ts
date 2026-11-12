import { describe, expect, it } from 'vitest';
import { loadDispatcherConfig } from './dispatcher-config';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadDispatcherConfig', () => {
  it('applies the spec defaults', () => {
    const config = loadDispatcherConfig({ ...base });
    expect(config).toMatchObject({
      retryBaseMs: 2_000,
      retryCapMs: 600_000,
      retentionDays: 7,
      retentionIntervalMs: 3_600_000,
      allowPrivateDestinations: true,
    });
  });

  it('blocks private destinations by default outside development', () => {
    expect(loadDispatcherConfig({ ...base, NODE_ENV: 'production' }).allowPrivateDestinations).toBe(
      false,
    );
  });

  it('rejects a base larger than the cap', () => {
    expect(() => loadDispatcherConfig({ ...base, RETRY_BASE_MS: '10', RETRY_CAP_MS: '5' })).toThrow(
      /RETRY_BASE_MS/,
    );
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadDispatcherConfig({})).toThrow(/DATABASE_URL/);
  });
});
