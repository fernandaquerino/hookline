import type { IncomingHttpHeaders } from 'node:http';

export const REDACTED = '[redacted]';

/** Always redacted, regardless of REDACT_HEADERS. */
export const ALWAYS_REDACTED_HEADERS: readonly string[] = ['authorization', 'cookie'];

/**
 * Normalises header names to lower case, joins repeated values and replaces sensitive values with
 * `[redacted]`. The result is what gets stored and shown in the inspector.
 */
export function redactHeaders(
  headers: IncomingHttpHeaders,
  extraRedacted: readonly string[] = [],
): Record<string, string> {
  const redacted = new Set([
    ...ALWAYS_REDACTED_HEADERS,
    ...extraRedacted.map((h) => h.toLowerCase()),
  ]);
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (rawValue === undefined) continue;
    const name = rawName.toLowerCase();
    const value = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
    result[name] = redacted.has(name) ? REDACTED : value;
  }
  return result;
}
