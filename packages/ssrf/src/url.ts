import { DestinationNotAllowedError } from './errors';
import { ipFamily } from './ip';
import { checkAddress } from './ranges';

export interface ParsedDestination {
  url: URL;
  /** Hostname without IPv6 brackets. */
  hostname: string;
  /** True when the hostname is an IP literal, which skips DNS (and so the lookup guard). */
  isIpLiteral: boolean;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parses a destination URL and applies the checks that need no DNS: http(s) only, and IP literals
 * (including the 0x7f000001 or 2130706433 spellings, which the URL parser normalises) must be
 * public unless private destinations are allowed.
 */
export function checkDestinationUrl(raw: string, allowPrivate: boolean): ParsedDestination {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DestinationNotAllowedError(`"${raw}" is not a valid URL`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new DestinationNotAllowedError(
      `Protocol ${url.protocol} is not allowed; use http or https`,
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const isIpLiteral = ipFamily(hostname) !== 0;
  if (!allowPrivate) {
    if (isIpLiteral) {
      const verdict = checkAddress(hostname);
      if (!verdict.allowed) throw new DestinationNotAllowedError(`Destination ${verdict.reason}`);
    } else if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new DestinationNotAllowedError(`Destination ${hostname} is loopback`);
    }
  }
  return { url, hostname, isIpLiteral };
}
