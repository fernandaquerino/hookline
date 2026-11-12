import { describe, expect, it } from 'vitest';
import { ErrorCode } from './errors';

describe('ErrorCode', () => {
  it('uses the code name as its value so codes stay stable on the wire', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
    }
  });
});
