import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKOFF, backoffCeilingMs, fullJitterDelayMs } from './backoff';

describe('backoffCeilingMs', () => {
  it('doubles from the 2 s base and caps at 10 min', () => {
    const ceilings = Array.from({ length: 12 }, (_, i) => backoffCeilingMs(i + 1));
    expect(ceilings).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 512_000, 600_000, 600_000,
      600_000,
    ]);
  });

  it('does not overflow for very large attempt numbers', () => {
    expect(backoffCeilingMs(10_000)).toBe(DEFAULT_BACKOFF.capMs);
  });

  it('rejects attempt numbers below 1 or non-integers', () => {
    expect(() => backoffCeilingMs(0)).toThrow(RangeError);
    expect(() => backoffCeilingMs(1.5)).toThrow(RangeError);
  });

  it('respects custom options', () => {
    expect(backoffCeilingMs(3, { baseMs: 100, capMs: 250 })).toBe(250);
  });
});

describe('fullJitterDelayMs', () => {
  it('stays within [0, ceiling) for the extremes of the random source', () => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const ceiling = backoffCeilingMs(attempt);
      expect(fullJitterDelayMs(attempt, DEFAULT_BACKOFF, () => 0)).toBe(0);
      const max = fullJitterDelayMs(attempt, DEFAULT_BACKOFF, () => 0.999999999);
      expect(max).toBeLessThan(ceiling);
      expect(max).toBeGreaterThanOrEqual(ceiling - 1);
    }
  });

  it('clamps a misbehaving random source into range', () => {
    expect(fullJitterDelayMs(1, DEFAULT_BACKOFF, () => 1)).toBeLessThan(2_000);
    expect(fullJitterDelayMs(1, DEFAULT_BACKOFF, () => -5)).toBe(0);
  });

  it('is uniformly spread with Math.random (statistical bounds)', () => {
    const samples = Array.from({ length: 5_000 }, () => fullJitterDelayMs(4));
    const ceiling = backoffCeilingMs(4);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThan(ceiling);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Mean of U(0, 16000) is 8000; allow a generous margin to keep the test stable.
    expect(mean).toBeGreaterThan(ceiling * 0.4);
    expect(mean).toBeLessThan(ceiling * 0.6);
  });

  it('returns integer milliseconds', () => {
    expect(Number.isInteger(fullJitterDelayMs(3, DEFAULT_BACKOFF, () => 0.123456))).toBe(true);
  });
});
