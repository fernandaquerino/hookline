import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Parses HOOKLINE_ENCRYPTION_KEY (32 bytes, base64). Throws with a clear message otherwise. */
export function parseEncryptionKey(value: string | undefined): Buffer {
  if (!value) {
    throw new Error('HOOKLINE_ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`HOOKLINE_ENCRYPTION_KEY must be ${KEY_BYTES} bytes encoded as base64`);
  }
  return key;
}

/** Encrypts a secret with AES-256-GCM. Output is base64 of `iv | tag | ciphertext`. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Decrypts a value produced by `encryptSecret`. Throws if the data was tampered with. */
export function decryptSecret(encoded: string, key: Buffer): string {
  const data = Buffer.from(encoded, 'base64');
  if (data.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted secret is malformed');
  }
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
