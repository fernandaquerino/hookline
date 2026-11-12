import { describe, expect, it } from 'vitest';
import { parseRetryAfterMs } from './retry-after';

const NOW = Date.parse('2026-01-01T12:00:00Z');

describe('parseRetryAfterMs', () => {
  it('parses delay-seconds', () => {
    expect(parseRetryAfterMs('0', NOW)).toBe(0);
    expect(parseRetryAfterMs('120', NOW)).toBe(120_000);
    expect(parseRetryAfterMs('  5 ', NOW)).toBe(5_000);
  });

  it('parses an HTTP date relative to now', () => {
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 12:00:30 GMT', NOW)).toBe(30_000);
  });

  it('returns 0 for a date in the past', () => {
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 11:00:00 GMT', NOW)).toBe(0);
  });

  it('returns null for missing or invalid values', () => {
    for (const value of [
      undefined,
      null,
      '',
      '   ',
      '-1',
      '1.5',
      'soon',
      '2026-01-01',
      'Foo, 99 Bar',
    ]) {
      expect(parseRetryAfterMs(value, NOW)).toBeNull();
    }
  });
});
