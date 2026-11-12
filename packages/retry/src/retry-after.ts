/**
 * Parses a `Retry-After` header value (delay in seconds or an HTTP date) into milliseconds from
 * `nowMs`. Returns null when the value is missing or not understood. Dates in the past yield 0.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  // Only accept things that look like an HTTP date, not arbitrary strings Date.parse tolerates.
  if (!/[a-z]{3},?\s/i.test(trimmed)) return null;
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}
