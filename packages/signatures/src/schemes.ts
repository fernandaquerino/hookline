import { getHeader } from './headers';
import { hmacSha256Hex, safeEqualHex } from './hmac';
import type { HeaderMap, VerifyResult } from './types';

/** Header used by the generic scheme: `X-Signature-256: sha256=<hex hmac of body>`. */
export const GENERIC_SIGNATURE_HEADER = 'x-signature-256';
/** GitHub: `X-Hub-Signature-256: sha256=<hex hmac of body>`. */
export const GITHUB_SIGNATURE_HEADER = 'x-hub-signature-256';
/** Stripe: `Stripe-Signature: t=<unix seconds>,v1=<hex hmac of "t.body">[,v1=...]`. */
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

export const DEFAULT_STRIPE_TOLERANCE_SECONDS = 300;

const VALID: VerifyResult = { status: 'valid' };

function invalid(reason: string): VerifyResult {
  return { status: 'invalid', reason };
}

function verifyPrefixedHex(
  headers: HeaderMap,
  headerName: string,
  secret: string,
  body: Buffer,
  prefixRequired: boolean,
): VerifyResult {
  const value = getHeader(headers, headerName)?.trim();
  if (!value) return invalid(`Missing ${headerName} header`);
  let candidate = value;
  if (value.startsWith('sha256=')) {
    candidate = value.slice('sha256='.length);
  } else if (prefixRequired) {
    return invalid(`${headerName} must start with sha256=`);
  }
  return safeEqualHex(hmacSha256Hex(secret, body), candidate)
    ? VALID
    : invalid('Signature does not match');
}

export function verifyGeneric(headers: HeaderMap, secret: string, body: Buffer): VerifyResult {
  return verifyPrefixedHex(headers, GENERIC_SIGNATURE_HEADER, secret, body, false);
}

export function verifyGithub(headers: HeaderMap, secret: string, body: Buffer): VerifyResult {
  return verifyPrefixedHex(headers, GITHUB_SIGNATURE_HEADER, secret, body, true);
}

interface StripeHeader {
  timestamp: number;
  v1: string[];
}

export function parseStripeHeader(value: string): StripeHeader | null {
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of value.split(',')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const item = part.slice(index + 1).trim();
    if (key === 't' && /^\d+$/.test(item)) timestamp = Number(item);
    if (key === 'v1') v1.push(item);
  }
  return timestamp === null ? null : { timestamp, v1 };
}

export function verifyStripe(
  headers: HeaderMap,
  secret: string,
  body: Buffer,
  nowMs: number,
  toleranceSeconds: number,
): VerifyResult {
  const value = getHeader(headers, STRIPE_SIGNATURE_HEADER);
  if (!value) return invalid(`Missing ${STRIPE_SIGNATURE_HEADER} header`);
  const parsed = parseStripeHeader(value);
  if (!parsed) return invalid('Stripe-Signature has no timestamp');
  if (parsed.v1.length === 0) return invalid('Stripe-Signature has no v1 signature');

  const signedPayload = Buffer.concat([Buffer.from(`${parsed.timestamp}.`, 'utf8'), body]);
  const expected = hmacSha256Hex(secret, signedPayload);
  // Check every candidate so the time taken does not depend on which one matched.
  const matched = parsed.v1.map((candidate) => safeEqualHex(expected, candidate)).includes(true);
  if (!matched) return invalid('Signature does not match');

  const ageSeconds = Math.abs(nowMs / 1000 - parsed.timestamp);
  if (ageSeconds > toleranceSeconds) {
    return invalid(`Timestamp outside the ${toleranceSeconds}s tolerance`);
  }
  return VALID;
}
