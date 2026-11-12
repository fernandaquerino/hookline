import { describe, expect, it } from 'vitest';
import { formatBytes, relativeTime, viewBody } from './format';

const b64 = (value: string | Uint8Array) => Buffer.from(value).toString('base64');

describe('viewBody', () => {
  it('pretty-prints JSON', () => {
    expect(viewBody(b64('{"a":1,"b":[true]}'), 'application/json')).toEqual({
      kind: 'json',
      pretty: '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}',
      raw: '{"a":1,"b":[true]}',
    });
  });

  it('detects JSON without a content type', () => {
    expect(viewBody(b64('[1,2]'), null).kind).toBe('json');
  });

  it('falls back to text for invalid JSON', () => {
    expect(viewBody(b64('{not json'), 'application/json')).toEqual({
      kind: 'text',
      raw: '{not json',
    });
  });

  it('decodes form bodies into entries', () => {
    expect(
      viewBody(b64('a=1&b=hello+world&c=%26'), 'application/x-www-form-urlencoded'),
    ).toMatchObject({
      kind: 'form',
      entries: [
        ['a', '1'],
        ['b', 'hello world'],
        ['c', '&'],
      ],
    });
  });

  it('shows UTF-8 text as text and other bytes as hex', () => {
    expect(viewBody(b64('héllo'), 'text/plain')).toEqual({ kind: 'text', raw: 'héllo' });
    const binary = viewBody(
      b64(new Uint8Array([0xff, 0xfe, 0x00, 0x41])),
      'application/octet-stream',
    );
    expect(binary).toMatchObject({ kind: 'binary', size: 4 });
    expect(binary.kind === 'binary' && binary.hex).toMatch(/^00000000 {2}ff fe 00 41 +\.\.\.A$/);
  });

  it('handles empty bodies', () => {
    expect(viewBody('', null)).toEqual({ kind: 'empty' });
  });
});

describe('formatting helpers', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(relativeTime(null, now)).toBe('never');
    expect(relativeTime('2026-01-01T11:59:58Z', now)).toBe('just now');
    expect(relativeTime('2026-01-01T11:59:30Z', now)).toBe('30 s ago');
    expect(relativeTime('2026-01-01T11:50:00Z', now)).toBe('10 min ago');
    expect(relativeTime('2026-01-01T09:00:00Z', now)).toBe('3 h ago');
  });
});
