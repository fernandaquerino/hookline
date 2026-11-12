import { describe, expect, it } from 'vitest';
import { signGeneric, signGithub, signStripe } from './sign';
import { parseStripeHeader } from './schemes';
import type { HeaderMap } from './types';
import { verifySignature } from './verify';

/**
 * Known-good vectors.
 * - GitHub: the example published in GitHub's "Validating webhook deliveries" documentation.
 * - Stripe and generic: HMAC-SHA256 computed independently with Python's `hmac` module, following
 *   Stripe's documented `"{t}.{body}"` signed-payload format.
 */
const GITHUB_VECTOR = {
  secret: "It's a Secret to Everybody",
  body: 'Hello, World!',
  header: 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
};

const STRIPE_VECTOR = {
  secret: 'whsec_test_secret_for_vectors',
  body: '{"id":"evt_test_vector","object":"event"}',
  timestamp: 1700000000,
  v1: '1b1a0c602f9f9d8d11b4a29c422a4c0f0cca9bb0b585255a41ce63c7ea0405d8',
};

const GENERIC_VECTOR = {
  secret: 'generic-secret',
  body: '{"hello":"world"}',
  header: 'sha256=9858e8fea916b4f991c984891b199af820f78dd387b5c596a48934a46b5d279a',
};

const body = (text: string): Buffer => Buffer.from(text, 'utf8');

describe('verifySignature: none / missing secret', () => {
  it('returns not_configured for scheme none, whatever the headers say', () => {
    expect(
      verifySignature({
        scheme: 'none',
        secret: 'x',
        headers: { 'x-hub-signature-256': 'sha256=00' },
        body: body('x'),
      }).status,
    ).toBe('not_configured');
  });

  it('returns not_configured when a signed scheme has no secret', () => {
    for (const secret of [null, '']) {
      const result = verifySignature({ scheme: 'github', secret, headers: {}, body: body('x') });
      expect(result.status).toBe('not_configured');
    }
  });
});

describe('verifySignature: github', () => {
  const verify = (headers: HeaderMap, text = GITHUB_VECTOR.body) =>
    verifySignature({ scheme: 'github', secret: GITHUB_VECTOR.secret, headers, body: body(text) });

  it('accepts the documented GitHub vector', () => {
    expect(verify({ 'x-hub-signature-256': GITHUB_VECTOR.header })).toEqual({ status: 'valid' });
  });

  it('matches the header name case-insensitively', () => {
    expect(verify({ 'X-Hub-Signature-256': GITHUB_VECTOR.header }).status).toBe('valid');
  });

  it('accepts upper-case hex digests', () => {
    const upper = `sha256=${GITHUB_VECTOR.header.slice(7).toUpperCase()}`;
    expect(verify({ 'x-hub-signature-256': upper }).status).toBe('valid');
  });

  it('matches what signGithub produces', () => {
    expect(signGithub(GITHUB_VECTOR.secret, GITHUB_VECTOR.body)).toBe(GITHUB_VECTOR.header);
  });

  it('rejects a modified body', () => {
    expect(verify({ 'x-hub-signature-256': GITHUB_VECTOR.header }, 'Hello, World?').status).toBe(
      'invalid',
    );
  });

  it('rejects a missing header, a missing prefix and malformed digests', () => {
    const bad = [
      {},
      { 'x-hub-signature-256': GITHUB_VECTOR.header.slice(7) },
      { 'x-hub-signature-256': 'sha256=' },
      { 'x-hub-signature-256': 'sha256=zz' },
      { 'x-hub-signature-256': `${GITHUB_VECTOR.header}00` },
      { 'x-hub-signature-256': 'sha1=757107ea0eb2509fc211221cce984b8a37570b6d' },
    ];
    for (const headers of bad) {
      const result = verify(headers);
      expect(result.status).toBe('invalid');
      expect(result.reason).toBeTruthy();
    }
  });

  it('rejects a signature made with another secret', () => {
    const header = signGithub('another secret', GITHUB_VECTOR.body);
    expect(verify({ 'x-hub-signature-256': header }).status).toBe('invalid');
  });

  it('uses the first value when a header is repeated', () => {
    expect(verify({ 'x-hub-signature-256': [GITHUB_VECTOR.header, 'sha256=00'] }).status).toBe(
      'valid',
    );
  });
});

describe('verifySignature: generic_sha256', () => {
  const verify = (headers: HeaderMap) =>
    verifySignature({
      scheme: 'generic_sha256',
      secret: GENERIC_VECTOR.secret,
      headers,
      body: body(GENERIC_VECTOR.body),
    });

  it('accepts the known vector with and without the sha256= prefix', () => {
    expect(verify({ 'x-signature-256': GENERIC_VECTOR.header }).status).toBe('valid');
    expect(verify({ 'x-signature-256': GENERIC_VECTOR.header.slice(7) }).status).toBe('valid');
    expect(signGeneric(GENERIC_VECTOR.secret, GENERIC_VECTOR.body)).toBe(GENERIC_VECTOR.header);
  });

  it('rejects a wrong or missing signature', () => {
    expect(verify({}).status).toBe('invalid');
    expect(verify({ 'x-signature-256': `sha256=${'0'.repeat(64)}` }).status).toBe('invalid');
  });

  it('verifies binary bodies byte for byte', () => {
    const raw = Buffer.from([0x00, 0xff, 0x10, 0x80]);
    const result = verifySignature({
      scheme: 'generic_sha256',
      secret: 's',
      headers: { 'x-signature-256': signGeneric('s', raw) },
      body: raw,
    });
    expect(result.status).toBe('valid');
  });
});

describe('verifySignature: stripe', () => {
  const nowMs = STRIPE_VECTOR.timestamp * 1000;
  const verify = (header: string | undefined, overrides: { nowMs?: number; text?: string } = {}) =>
    verifySignature({
      scheme: 'stripe',
      secret: STRIPE_VECTOR.secret,
      headers: header === undefined ? {} : { 'stripe-signature': header },
      body: body(overrides.text ?? STRIPE_VECTOR.body),
      nowMs: overrides.nowMs ?? nowMs,
    });
  const header = `t=${STRIPE_VECTOR.timestamp},v1=${STRIPE_VECTOR.v1}`;

  it('accepts the known vector', () => {
    expect(verify(header)).toEqual({ status: 'valid' });
  });

  it('matches what signStripe produces', () => {
    expect(signStripe(STRIPE_VECTOR.secret, STRIPE_VECTOR.body, STRIPE_VECTOR.timestamp)).toBe(
      header,
    );
  });

  it('accepts when any of several v1 signatures matches (secret rotation) and ignores v0', () => {
    const rotated = `t=${STRIPE_VECTOR.timestamp},v1=${'a'.repeat(64)},v0=${'b'.repeat(64)},v1=${STRIPE_VECTOR.v1}`;
    expect(verify(rotated).status).toBe('valid');
  });

  it('enforces the timestamp tolerance in both directions', () => {
    expect(verify(header, { nowMs: nowMs + 300_000 }).status).toBe('valid');
    expect(verify(header, { nowMs: nowMs + 301_000 }).status).toBe('invalid');
    expect(verify(header, { nowMs: nowMs - 301_000 }).status).toBe('invalid');
  });

  it('supports a custom tolerance', () => {
    const result = verifySignature({
      scheme: 'stripe',
      secret: STRIPE_VECTOR.secret,
      headers: { 'stripe-signature': header },
      body: body(STRIPE_VECTOR.body),
      nowMs: nowMs + 10_000,
      toleranceSeconds: 5,
    });
    expect(result.status).toBe('invalid');
  });

  it('rejects a timestamp that was changed after signing', () => {
    expect(verify(`t=${STRIPE_VECTOR.timestamp + 1},v1=${STRIPE_VECTOR.v1}`).status).toBe(
      'invalid',
    );
  });

  it('rejects missing, empty and malformed headers', () => {
    for (const value of [
      undefined,
      '',
      'garbage',
      `v1=${STRIPE_VECTOR.v1}`,
      't=abc,v1=00',
      't=1',
    ]) {
      expect(verify(value).status).toBe('invalid');
    }
  });

  it('rejects a modified body', () => {
    expect(verify(header, { text: '{"id":"evt_other"}' }).status).toBe('invalid');
  });
});

describe('parseStripeHeader', () => {
  it('parses timestamp and v1 entries, tolerating whitespace', () => {
    expect(parseStripeHeader('t=12, v1=aa ,v1=bb,v0=cc')).toEqual({
      timestamp: 12,
      v1: ['aa', 'bb'],
    });
  });
});
