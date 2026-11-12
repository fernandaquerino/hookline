import { hmacSha256Hex } from './hmac';

/**
 * Signature builders, mainly for tests, the seed and local tooling. They produce the header value
 * a provider would send for the given body.
 */
export function signGeneric(secret: string, body: Buffer | string): string {
  return `sha256=${hmacSha256Hex(secret, body)}`;
}

export function signGithub(secret: string, body: Buffer | string): string {
  return `sha256=${hmacSha256Hex(secret, body)}`;
}

export function signStripe(
  secret: string,
  body: Buffer | string,
  timestampSeconds: number,
): string {
  const payload = Buffer.concat([
    Buffer.from(`${timestampSeconds}.`, 'utf8'),
    typeof body === 'string' ? Buffer.from(body, 'utf8') : body,
  ]);
  return `t=${timestampSeconds},v1=${hmacSha256Hex(secret, payload)}`;
}
