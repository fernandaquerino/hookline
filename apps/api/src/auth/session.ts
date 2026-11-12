import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'hookline_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Creates a stateless session token: `<expiresAtMs>.<nonce>.<hmac>`. */
export function createSessionToken(secret: string, nowMs: number = Date.now()): string {
  const payload = `${nowMs + SESSION_TTL_MS}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Checks the signature and expiry of a session token. */
export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  if (!token) return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return false;
  const payload = token.slice(0, lastDot);
  const signature = Buffer.from(token.slice(lastDot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return false;
  const expiresAt = Number(payload.split('.')[0]);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

/** Minimal Cookie header parser; returns the named cookie's value. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  const attributes = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}
