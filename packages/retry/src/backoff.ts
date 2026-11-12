export interface BackoffOptions {
  /** Delay ceiling for the first retry, in milliseconds. */
  baseMs: number;
  /** Maximum delay between attempts, in milliseconds. */
  capMs: number;
}

export const DEFAULT_BACKOFF: Readonly<BackoffOptions> = { baseMs: 2_000, capMs: 600_000 };

export const DEFAULT_MAX_ATTEMPTS = 8;

/** A source of uniformly distributed numbers in [0, 1), injectable for tests. */
export type RandomSource = () => number;

/**
 * Upper bound of the delay after the given failed attempt (1-based):
 * `min(cap, base * 2^(attempt - 1))`.
 */
export function backoffCeilingMs(
  failedAttempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
): number {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) {
    throw new RangeError(`failedAttempt must be a positive integer, got ${failedAttempt}`);
  }
  // Cap the exponent so huge attempt numbers cannot overflow to Infinity.
  const exponent = Math.min(failedAttempt - 1, 52);
  return Math.min(options.capMs, options.baseMs * 2 ** exponent);
}

/**
 * "Full jitter" backoff: a uniformly random delay in [0, ceiling). Spreads retries out so many
 * failing deliveries do not hit a recovering destination at the same moment.
 */
export function fullJitterDelayMs(
  failedAttempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: RandomSource = Math.random,
): number {
  const ceiling = backoffCeilingMs(failedAttempt, options);
  const sample = Math.min(Math.max(random(), 0), 1 - Number.EPSILON);
  return Math.floor(sample * ceiling);
}
