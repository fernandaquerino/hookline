export {
  DESTINATION_NOT_ALLOWED,
  DestinationNotAllowedError,
  isDestinationNotAllowed,
} from './errors';
export { checkAddress, type AddressVerdict } from './ranges';
export { checkDestinationUrl, type ParsedDestination } from './url';
export {
  createGuardedLookup,
  resolvePublicAddresses,
  systemResolver,
  type Resolver,
} from './lookup';

import { resolvePublicAddresses, type Resolver } from './lookup';
import { checkDestinationUrl } from './url';

/**
 * Full save-time check: URL rules plus DNS resolution. The dispatcher repeats the DNS check at
 * delivery time, because a hostname can resolve differently later.
 */
export async function assertDestinationAllowed(
  raw: string,
  options: { allowPrivate: boolean; resolver?: Resolver },
): Promise<void> {
  const parsed = checkDestinationUrl(raw, options.allowPrivate);
  if (options.allowPrivate || parsed.isIpLiteral) return;
  await resolvePublicAddresses(parsed.hostname, options.resolver);
}
