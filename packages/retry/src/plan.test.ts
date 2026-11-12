import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_ATTEMPTS } from './backoff';
import { planNextAttempt } from './plan';

describe('planNextAttempt', () => {
  const base = { maxAttempts: DEFAULT_MAX_ATTEMPTS, random: () => 0.5 };

  it('defaults to 8 attempts', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(8);
  });

  it('marks success', () => {
    expect(planNextAttempt({ ...base, attemptNumber: 3, outcome: 'success' })).toEqual({
      kind: 'succeeded',
    });
  });

  it('dead-letters permanent failures immediately', () => {
    expect(planNextAttempt({ ...base, attemptNumber: 1, outcome: 'permanent' })).toEqual({
      kind: 'dead',
      reason: 'permanent_failure',
    });
  });

  it('retries with jittered backoff until maxAttempts, then dead-letters', () => {
    for (let attempt = 1; attempt < DEFAULT_MAX_ATTEMPTS; attempt++) {
      const step = planNextAttempt({ ...base, attemptNumber: attempt, outcome: 'retryable' });
      expect(step).toEqual({ kind: 'retry', delayMs: 2_000 * 2 ** (attempt - 1) * 0.5 });
    }
    expect(
      planNextAttempt({ ...base, attemptNumber: DEFAULT_MAX_ATTEMPTS, outcome: 'retryable' }),
    ).toEqual({ kind: 'dead', reason: 'max_attempts' });
  });

  it('honours Retry-After as a minimum delay', () => {
    const step = planNextAttempt({
      ...base,
      attemptNumber: 1,
      outcome: 'retryable',
      retryAfterMs: 45_000,
    });
    expect(step).toEqual({ kind: 'retry', delayMs: 45_000 });
  });

  it('keeps the jittered delay when it is longer than Retry-After', () => {
    const step = planNextAttempt({
      ...base,
      attemptNumber: 8,
      maxAttempts: 10,
      outcome: 'retryable',
      retryAfterMs: 1_000,
    });
    expect(step).toEqual({ kind: 'retry', delayMs: 128_000 });
  });

  it('clamps Retry-After to the backoff cap', () => {
    const step = planNextAttempt({
      ...base,
      attemptNumber: 1,
      outcome: 'retryable',
      retryAfterMs: 86_400_000,
    });
    expect(step).toEqual({ kind: 'retry', delayMs: 600_000 });
  });

  it('does not retry past maxAttempts even with Retry-After', () => {
    expect(
      planNextAttempt({
        ...base,
        attemptNumber: 2,
        maxAttempts: 2,
        outcome: 'retryable',
        retryAfterMs: 5,
      }),
    ).toEqual({ kind: 'dead', reason: 'max_attempts' });
  });
});
