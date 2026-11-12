import {
  DEFAULT_STRIPE_TOLERANCE_SECONDS,
  verifyGeneric,
  verifyGithub,
  verifyStripe,
} from './schemes';
import type { VerifyInput, VerifyResult } from './types';

/** Verifies a webhook signature for the given scheme. Never throws on malformed input. */
export function verifySignature(input: VerifyInput): VerifyResult {
  if (input.scheme === 'none') {
    return { status: 'not_configured' };
  }
  if (!input.secret) {
    return { status: 'not_configured', reason: 'No signing secret configured' };
  }
  switch (input.scheme) {
    case 'generic_sha256':
      return verifyGeneric(input.headers, input.secret, input.body);
    case 'github':
      return verifyGithub(input.headers, input.secret, input.body);
    case 'stripe':
      return verifyStripe(
        input.headers,
        input.secret,
        input.body,
        input.nowMs ?? Date.now(),
        input.toleranceSeconds ?? DEFAULT_STRIPE_TOLERANCE_SECONDS,
      );
  }
}
