/** RFC 9110 section 7.6.1 hop-by-hop headers, plus legacy ones proxies commonly strip. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Recomputed or meaningless for the outgoing request. */
const NOT_FORWARDED = new Set(['host', 'content-length', 'expect']);

const REDACTED = '[redacted]';

export interface ForwardContext {
  deliveryId: string;
  attempt: number;
}

/**
 * Builds the outgoing headers from the stored (already redacted) request headers: strips
 * hop-by-hop headers and anything named in `Connection`, drops redacted values instead of sending
 * the placeholder, and sets the Hookline headers (overwriting any spoofed incoming ones).
 */
export function buildForwardHeaders(
  stored: Record<string, string>,
  context: ForwardContext,
): Record<string, string> {
  const connectionListed = new Set(
    (stored.connection ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  const headers: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(stored)) {
    const name = rawName.toLowerCase();
    if (HOP_BY_HOP.has(name) || NOT_FORWARDED.has(name) || connectionListed.has(name)) continue;
    if (name.startsWith('x-hookline-') || value === REDACTED) continue;
    headers[name] = value;
  }
  headers['x-hookline-delivery-id'] = context.deliveryId;
  headers['x-hookline-attempt'] = String(context.attempt);
  return headers;
}

/** Parses stored JSON headers defensively; non-string values are ignored. */
export function storedHeaders(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item === 'string') result[name] = item;
  }
  return result;
}
