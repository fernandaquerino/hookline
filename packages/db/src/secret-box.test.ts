import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, parseEncryptionKey } from './secret-box';

const key = randomBytes(32);

describe('secret box', () => {
  it('round-trips a secret', () => {
    const encoded = encryptSecret('whsec_example_only', key);
    expect(encoded).not.toContain('whsec_example_only');
    expect(decryptSecret(encoded, key)).toBe('whsec_example_only');
  });

  it('uses a fresh IV for every encryption', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('rejects tampered ciphertext', () => {
    const data = Buffer.from(encryptSecret('secret', key), 'base64');
    data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptSecret(data.toString('base64'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    const encoded = encryptSecret('secret', key);
    expect(() => decryptSecret(encoded, randomBytes(32))).toThrow();
  });

  it('validates the key format', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/not set/);
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseEncryptionKey(key.toString('base64'))).toEqual(key);
  });
});
