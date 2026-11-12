import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';

const KEY_LENGTH = 32;
const DEFAULTS = { N: 16_384, r: 8, p: 1 } as const;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Hash format: `scrypt$N$r$p$<salt base64>$<hash base64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, DEFAULTS);
  return [
    'scrypt',
    DEFAULTS.N,
    DEFAULTS.r,
    DEFAULTS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/** Verifies a password against a stored hash in constant time. Malformed hashes never match. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const N = Number(n);
  const options = { N, r: Number(r), p: Number(p), maxmem: 256 * N * Number(r) };
  if (![options.N, options.r, options.p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const expected = Buffer.from(hashB64 ?? '', 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(saltB64 ?? '', 'base64'), options);
  return timingSafeEqual(actual, expected);
}
