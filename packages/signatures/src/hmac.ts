import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

export function hmacSha256Hex(secret: string, payload: Buffer | string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Compares a hex signature against the expected digest in constant time. The digest length is
 * fixed and public, so rejecting malformed input early does not leak secret information.
 */
export function safeEqualHex(expectedHex: string, candidateHex: string): boolean {
  if (!HEX_SHA256.test(candidateHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const candidate = Buffer.from(candidateHex, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
