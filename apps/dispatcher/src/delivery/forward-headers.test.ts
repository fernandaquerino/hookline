import { describe, expect, it } from 'vitest';
import { buildForwardHeaders, storedHeaders } from './forward-headers';

const ctx = { deliveryId: 'd-1', attempt: 3 };

describe('buildForwardHeaders', () => {
  it('keeps end-to-end headers and adds the Hookline headers', () => {
    expect(
      buildForwardHeaders(
        { 'content-type': 'application/json', 'x-github-event': 'push', 'user-agent': 'GitHub' },
        ctx,
      ),
    ).toEqual({
      'content-type': 'application/json',
      'x-github-event': 'push',
      'user-agent': 'GitHub',
      'x-hookline-delivery-id': 'd-1',
      'x-hookline-attempt': '3',
    });
  });

  it('strips hop-by-hop headers, host, content-length and Connection-listed headers', () => {
    const headers = buildForwardHeaders(
      {
        connection: 'keep-alive, x-private-hop',
        'keep-alive': 'timeout=5',
        'transfer-encoding': 'chunked',
        te: 'trailers',
        trailer: 'x',
        upgrade: 'h2c',
        'proxy-authorization': 'Basic abc',
        'proxy-connection': 'keep-alive',
        host: 'hookline.local',
        'content-length': '12',
        expect: '100-continue',
        'x-private-hop': '1',
        'x-kept': 'yes',
      },
      ctx,
    );
    expect(Object.keys(headers).sort()).toEqual([
      'x-hookline-attempt',
      'x-hookline-delivery-id',
      'x-kept',
    ]);
  });

  it('does not forward redacted placeholders or spoofed Hookline headers', () => {
    const headers = buildForwardHeaders(
      { authorization: '[redacted]', 'x-hookline-attempt': '99', 'X-Hookline-Delivery-Id': 'evil' },
      ctx,
    );
    expect(headers).toEqual({ 'x-hookline-delivery-id': 'd-1', 'x-hookline-attempt': '3' });
  });
});

describe('storedHeaders', () => {
  it('ignores non-object and non-string values', () => {
    expect(storedHeaders(null)).toEqual({});
    expect(storedHeaders(['a'])).toEqual({});
    expect(storedHeaders({ a: 'b', n: 1, o: {} })).toEqual({ a: 'b' });
  });
});
