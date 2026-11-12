import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from './login-rate-limiter';
import {
  SESSION_TTL_MS,
  createSessionToken,
  readCookie,
  sessionCookie,
  verifySessionToken,
} from './session';

const secret = 'test-secret-test-secret';

describe('session tokens', () => {
  it('accepts a fresh token and rejects it after expiry', () => {
    const now = 1_700_000_000_000;
    const token = createSessionToken(secret, now);
    expect(verifySessionToken(token, secret, now + 1000)).toBe(true);
    expect(verifySessionToken(token, secret, now + SESSION_TTL_MS + 1)).toBe(false);
  });

  it('rejects tampered tokens and other secrets', () => {
    const token = createSessionToken(secret);
    const [expires, nonce, sig] = token.split('.');
    expect(verifySessionToken(`${Number(expires) + 1}.${nonce}.${sig}`, secret)).toBe(false);
    expect(verifySessionToken(token, 'another-secret-another')).toBe(false);
    expect(verifySessionToken(undefined, secret)).toBe(false);
    expect(verifySessionToken('garbage', secret)).toBe(false);
  });

  it('builds an HttpOnly, SameSite cookie, Secure when asked', () => {
    expect(sessionCookie('abc', false)).toMatch(
      /^hookline_session=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/,
    );
    expect(sessionCookie('abc', true)).toMatch(/; Secure$/);
  });

  it('reads a cookie from a Cookie header', () => {
    expect(readCookie('a=1; hookline_session=x%2Ey; b=2', 'hookline_session')).toBe('x.y');
    expect(readCookie('a=1', 'hookline_session')).toBeUndefined();
    expect(readCookie(undefined, 'hookline_session')).toBeUndefined();
  });
});

describe('LoginRateLimiter', () => {
  it('allows up to the limit per window', () => {
    const limiter = new LoginRateLimiter(2, 1000);
    expect(limiter.tryAcquire('ip', 0)).toBe(true);
    expect(limiter.tryAcquire('ip', 1)).toBe(true);
    expect(limiter.tryAcquire('ip', 2)).toBe(false);
    expect(limiter.tryAcquire('other', 2)).toBe(true);
    expect(limiter.tryAcquire('ip', 1000)).toBe(true);
  });
});
