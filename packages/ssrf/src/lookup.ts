import { type LookupAddress, lookup as dnsLookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { DestinationNotAllowedError } from './errors';
import { checkAddress } from './ranges';

/** Resolves every address for a hostname. Injectable so tests can simulate DNS rebinding. */
export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

export const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    );
  });

/**
 * Resolves a hostname and refuses it if any address is not public. Rejecting on any bad address
 * (not just the first) stops a record set that mixes public and private addresses.
 */
export async function resolvePublicAddresses(
  hostname: string,
  resolver: Resolver = systemResolver,
): Promise<LookupAddress[]> {
  const addresses = await resolver(hostname);
  if (addresses.length === 0) {
    throw new DestinationNotAllowedError(`${hostname} did not resolve to any address`);
  }
  for (const { address } of addresses) {
    const verdict = checkAddress(address);
    if (!verdict.allowed) {
      throw new DestinationNotAllowedError(`${hostname} resolves to ${verdict.reason}`);
    }
  }
  return addresses;
}

/**
 * A `lookup` for `net.connect` (and undici's connector) that validates addresses at connect time.
 * The socket connects to exactly the address that was checked, so a DNS answer that changes
 * between save and delivery (rebinding) cannot reach a private address.
 */
export function createGuardedLookup(options: {
  allowPrivate: boolean;
  resolver?: Resolver;
}): LookupFunction {
  const resolver = options.resolver ?? systemResolver;
  return (hostname, lookupOptions, callback) => {
    const resolveAll = options.allowPrivate
      ? resolver(hostname)
      : resolvePublicAddresses(hostname, resolver);
    resolveAll.then(
      (all) => {
        const family =
          lookupOptions.family === 'IPv4'
            ? 4
            : lookupOptions.family === 'IPv6'
              ? 6
              : lookupOptions.family;
        const candidates =
          family === 4 || family === 6 ? all.filter((a) => a.family === family) : all;
        if (candidates.length === 0) {
          callback(
            Object.assign(new Error(`No IPv${family} address for ${hostname}`), {
              code: 'ENOTFOUND',
            }),
            '',
            0,
          );
          return;
        }
        if (lookupOptions.all) {
          (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, candidates);
        } else {
          const [first] = candidates;
          callback(null, first?.address ?? '', first?.family ?? 4);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, '', 0),
    );
  };
}
