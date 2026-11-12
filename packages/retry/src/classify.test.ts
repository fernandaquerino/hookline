import { describe, expect, it } from 'vitest';
import { classifyAttempt } from './classify';

describe('classifyAttempt', () => {
  it('treats 2xx as success', () => {
    for (const status of [200, 201, 202, 204, 299]) {
      expect(classifyAttempt({ status })).toBe('success');
    }
  });

  it('retries network errors, timeouts, 408, 429 and 5xx', () => {
    expect(classifyAttempt({ networkError: true })).toBe('retryable');
    expect(classifyAttempt({})).toBe('retryable');
    for (const status of [408, 429, 500, 502, 503, 504, 599]) {
      expect(classifyAttempt({ status })).toBe('retryable');
    }
  });

  it('treats other 4xx, 3xx and 1xx as final failures', () => {
    for (const status of [400, 401, 403, 404, 405, 409, 410, 413, 422, 301, 302, 304, 101]) {
      expect(classifyAttempt({ status })).toBe('permanent');
    }
  });
});
