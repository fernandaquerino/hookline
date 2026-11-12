import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('correct horsf', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('never matches malformed hashes', async () => {
    for (const stored of [
      '',
      'plain',
      'scrypt$1$2$3',
      'bcrypt$a$b$c$d$e',
      'scrypt$x$8$1$c2FsdA==$aGFzaA==',
    ]) {
      expect(await verifyPassword('anything', stored)).toBe(false);
    }
  });
});
