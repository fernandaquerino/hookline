import { describe, expect, it } from 'vitest';
import { expandIPv6 } from './ip';
import { checkAddress } from './ranges';

const BLOCKED_V4 = [
  '0.0.0.0',
  '0.1.2.3',
  '10.0.0.1',
  '10.255.255.255',
  '100.64.0.1',
  '100.127.255.254',
  '127.0.0.1',
  '127.255.255.254',
  '169.254.169.254', // cloud metadata
  '172.16.0.1',
  '172.31.255.255',
  '192.0.0.1',
  '192.0.2.10',
  '192.168.0.1',
  '192.168.255.255',
  '198.18.0.1',
  '198.19.255.255',
  '224.0.0.1',
  '239.255.255.250',
  '240.0.0.1',
  '255.255.255.255',
];

const ALLOWED_V4 = [
  '1.1.1.1',
  '8.8.8.8',
  '93.184.216.34',
  '100.63.255.255',
  '100.128.0.0',
  '172.15.255.255',
  '172.32.0.0',
  '192.167.255.255',
  '192.169.0.0',
  '198.17.255.255',
  '198.20.0.0',
  '223.255.255.255',
];

const BLOCKED_V6 = [
  '::',
  '::1',
  '0:0:0:0:0:0:0:1',
  '::2', // inside the deprecated ::/96 block
  'fc00::1',
  'fd12:3456:789a::1',
  'fe80::1',
  'fe80::1%eth0',
  'febf:ffff::1',
  'fec0::1',
  'ff02::1',
  '2001:db8::1',
  '100::1',
  // IPv4-mapped and translated forms of private addresses
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::FFFF:10.0.0.1',
  '::ffff:169.254.169.254',
  '::127.0.0.1',
  '64:ff9b::7f00:1',
  '64:ff9b::10.0.0.1',
  '2002:7f00:1::1',
  '2002:c0a8:101::',
];

const ALLOWED_V6 = [
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
  '2a00:1450:4001:80b::200e',
  '::ffff:8.8.8.8',
  '64:ff9b::808:808',
  '2002:808:808::1',
  'fe7f::1', // just below fe80::/10
];

describe('checkAddress', () => {
  it.each(BLOCKED_V4)('blocks IPv4 %s', (address) => {
    const verdict = checkAddress(address);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain(address);
  });

  it.each(ALLOWED_V4)('allows public IPv4 %s', (address) => {
    expect(checkAddress(address)).toEqual({ allowed: true });
  });

  it.each(BLOCKED_V6)('blocks IPv6 %s', (address) => {
    expect(checkAddress(address).allowed).toBe(false);
  });

  it.each(ALLOWED_V6)('allows public IPv6 %s', (address) => {
    expect(checkAddress(address)).toEqual({ allowed: true });
  });

  it('explains embedded IPv4 verdicts', () => {
    expect(checkAddress('::ffff:127.0.0.1').reason).toMatch(/embeds 127\.0\.0\.1 is loopback/);
  });

  it('rejects things that are not IP addresses', () => {
    for (const value of ['', 'example.com', '256.1.1.1', '1.2.3', ':::1']) {
      expect(checkAddress(value).allowed).toBe(false);
    }
  });
});

describe('expandIPv6', () => {
  it('expands compressed and dotted forms', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('fe80::1%lo0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(expandIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(expandIPv6('nope')).toBeNull();
  });
});
