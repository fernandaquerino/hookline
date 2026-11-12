import { describe, expect, it } from 'vitest';
import { REDACTED, redactHeaders } from './redact';

describe('redactHeaders', () => {
  it('always redacts Authorization and Cookie', () => {
    expect(
      redactHeaders({ authorization: 'Bearer abc', cookie: 'a=b', 'content-type': 'text/plain' }),
    ).toEqual({ authorization: REDACTED, cookie: REDACTED, 'content-type': 'text/plain' });
  });

  it('redacts configured headers case-insensitively', () => {
    expect(redactHeaders({ 'x-api-key': 'k', 'x-other': 'v' }, ['X-Api-Key'])).toEqual({
      'x-api-key': REDACTED,
      'x-other': 'v',
    });
  });

  it('lower-cases names and joins repeated values', () => {
    expect(redactHeaders({ 'X-Multi': ['a', 'b'], skip: undefined })).toEqual({
      'x-multi': 'a, b',
    });
  });

  it('keeps signature headers so the inspector can show them', () => {
    expect(redactHeaders({ 'x-hub-signature-256': 'sha256=abc' })).toEqual({
      'x-hub-signature-256': 'sha256=abc',
    });
  });
});
