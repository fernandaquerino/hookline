import {
  type BackoffOptions,
  DEFAULT_BACKOFF,
  type RandomSource,
  fullJitterDelayMs,
} from './backoff';
import type { AttemptOutcome } from './classify';

export interface PlanInput {
  /** 1-based number of the attempt that just finished. */
  attemptNumber: number;
  maxAttempts: number;
  outcome: AttemptOutcome;
  /** Parsed Retry-After delay, if the destination sent one. */
  retryAfterMs?: number | null;
  backoff?: BackoffOptions;
  random?: RandomSource;
}

export type NextStep =
  | { kind: 'succeeded' }
  | { kind: 'retry'; delayMs: number }
  | { kind: 'dead'; reason: 'permanent_failure' | 'max_attempts' };

/**
 * Decides what happens after an attempt. A Retry-After value is honoured as a minimum delay,
 * clamped to the backoff cap so a destination cannot park a delivery indefinitely.
 */
export function planNextAttempt(input: PlanInput): NextStep {
  if (input.outcome === 'success') return { kind: 'succeeded' };
  if (input.outcome === 'permanent') return { kind: 'dead', reason: 'permanent_failure' };
  if (input.attemptNumber >= input.maxAttempts) return { kind: 'dead', reason: 'max_attempts' };

  const backoff = input.backoff ?? DEFAULT_BACKOFF;
  const jitter = fullJitterDelayMs(input.attemptNumber, backoff, input.random);
  const retryAfter = input.retryAfterMs ?? null;
  const delayMs =
    retryAfter === null ? jitter : Math.max(jitter, Math.min(retryAfter, backoff.capMs));
  return { kind: 'retry', delayMs };
}
