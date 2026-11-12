import { describe, expect, it } from 'vitest';
import { envBoolean, envList, resolveAllowPrivateDestinations } from './env';

describe('env helpers', () => {
  it('parses booleans strictly', () => {
    expect(envBoolean.parse('TRUE')).toBe(true);
    expect(envBoolean.parse('1')).toBe(true);
    expect(envBoolean.parse(' false ')).toBe(false);
    expect(envBoolean.safeParse('yes').success).toBe(false);
  });

  it('parses lists', () => {
    expect(envList.parse(' X-Api-Key, ,x-other ')).toEqual(['x-api-key', 'x-other']);
    expect(envList.parse('')).toEqual([]);
  });

  it('defaults ALLOW_PRIVATE_DESTINATIONS to true only in development', () => {
    expect(resolveAllowPrivateDestinations(undefined, 'development')).toBe(true);
    expect(resolveAllowPrivateDestinations(undefined, 'production')).toBe(false);
    expect(resolveAllowPrivateDestinations(undefined, 'test')).toBe(false);
    expect(resolveAllowPrivateDestinations(undefined, undefined)).toBe(false);
    expect(resolveAllowPrivateDestinations('false', 'development')).toBe(false);
    expect(resolveAllowPrivateDestinations('true', 'production')).toBe(true);
  });
});
