import { describe, expect, it } from 'vitest';
import { DestinationNotAllowedError } from './errors';
import { checkDestinationUrl } from './url';

const blocked = (url: string) => () => checkDestinationUrl(url, false);

describe('checkDestinationUrl', () => {
  it('accepts public http and https URLs', () => {
    expect(checkDestinationUrl('https://hooks.example.com/x', false)).toMatchObject({
      hostname: 'hooks.example.com',
      isIpLiteral: false,
    });
    expect(checkDestinationUrl('http://8.8.8.8:8080/', false).isIpLiteral).toBe(true);
  });

  it('rejects other protocols and invalid URLs even when private destinations are allowed', () => {
    for (const url of ['ftp://example.com', 'file:///etc/passwd', 'gopher://x', 'not a url']) {
      expect(() => checkDestinationUrl(url, true)).toThrow(DestinationNotAllowedError);
    }
  });

  it('rejects private IP literals, including alternative spellings', () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://127.1/',
      'http://0x7f000001/',
      'http://2130706433/',
      'http://017700000001/',
      'http://[::1]:3000/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd00::1]/',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0:4000/',
    ]) {
      expect(blocked(url), url).toThrow(DestinationNotAllowedError);
    }
  });

  it('rejects localhost names without DNS', () => {
    expect(blocked('http://localhost:3000/')).toThrow(/loopback/);
    expect(blocked('http://api.localhost/')).toThrow(/loopback/);
  });

  it('allows private destinations when configured', () => {
    expect(checkDestinationUrl('http://localhost:3000/webhooks', true).hostname).toBe('localhost');
    expect(checkDestinationUrl('http://[::1]:3000/', true).hostname).toBe('::1');
  });
});
