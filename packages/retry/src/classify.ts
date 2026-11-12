export type AttemptOutcome = 'success' | 'retryable' | 'permanent';

export interface AttemptResult {
  /** HTTP status, when a response was received. */
  status?: number;
  /** True for network errors, DNS failures, resets and timeouts. */
  networkError?: boolean;
}

const RETRYABLE_STATUSES = new Set([408, 429]);

/**
 * Classifies one delivery attempt:
 * - 2xx is a success;
 * - network errors, timeouts, 408, 429 and 5xx are retried;
 * - everything else (other 4xx, and 1xx/3xx because redirects are not followed) is final.
 */
export function classifyAttempt(result: AttemptResult): AttemptOutcome {
  if (result.networkError || result.status === undefined) return 'retryable';
  const { status } = result;
  if (status >= 200 && status < 300) return 'success';
  if (status >= 500 || RETRYABLE_STATUSES.has(status)) return 'retryable';
  return 'permanent';
}
