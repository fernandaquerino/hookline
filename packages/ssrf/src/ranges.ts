import { BlockList } from 'node:net';
import { embeddedIPv4, expandIPv6, ipFamily } from './ip';

/** Ranges a webhook destination must never reach unless private destinations are allowed. */
const IPV4_BLOCKED: Array<[string, number, string]> = [
  ['0.0.0.0', 8, 'this network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.88.99.0', 24, '6to4 relay anycast'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

const IPV6_BLOCKED: Array<[string, number, string]> = [
  ['::', 128, 'unspecified'],
  ['::1', 128, 'loopback'],
  ['100::', 64, 'discard-only'],
  ['2001:db8::', 32, 'documentation'],
  ['fc00::', 7, 'unique local'],
  ['fe80::', 10, 'link-local'],
  ['fec0::', 10, 'site-local (deprecated)'],
  ['ff00::', 8, 'multicast'],
];

function buildList(entries: Array<[string, number, string]>, type: 'ipv4' | 'ipv6') {
  return entries.map(([network, prefix, label]) => {
    const list = new BlockList();
    list.addSubnet(network, prefix, type);
    return { list, label: `${label} (${network}/${prefix})` };
  });
}

const V4 = buildList(IPV4_BLOCKED, 'ipv4');
const V6 = buildList(IPV6_BLOCKED, 'ipv6');

export interface AddressVerdict {
  allowed: boolean;
  /** Why the address is blocked. */
  reason?: string;
}

function checkIPv4(address: string): AddressVerdict {
  const hit = V4.find(({ list }) => list.check(address, 'ipv4'));
  return hit ? { allowed: false, reason: `${address} is ${hit.label}` } : { allowed: true };
}

/**
 * Decides whether an IP address is a public unicast address. IPv6 forms that embed an IPv4
 * address (mapped, compatible, NAT64 and 6to4) are judged by the embedded address, so
 * `::ffff:127.0.0.1` cannot be used to reach loopback.
 */
export function checkAddress(address: string): AddressVerdict {
  const family = ipFamily(address);
  if (family === 4) return checkIPv4(address);
  if (family === 0) return { allowed: false, reason: `${address} is not an IP address` };

  const groups = expandIPv6(address);
  if (!groups) return { allowed: false, reason: `${address} is not an IP address` };
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0] = groups;
  const firstFiveZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  // ::ffff:a.b.c.d (IPv4-mapped).
  if (firstFiveZero && g5 === 0xffff) {
    return withContext(checkIPv4(embeddedIPv4(groups)), address);
  }
  // ::/96: unspecified, loopback and the deprecated IPv4-compatible form. None is routable.
  if (firstFiveZero && g5 === 0) {
    const normalized = groups.map((g) => g.toString(16)).join(':');
    const hit = V6.find(({ list }) => list.check(normalized, 'ipv6'));
    return { allowed: false, reason: `${address} is ${hit?.label ?? 'reserved (::/96)'}` };
  }
  // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64).
  if (g0 === 0x64 && g1 === 0xff9b) {
    return withContext(checkIPv4(embeddedIPv4(groups)), address);
  }
  // 2002::/16 (6to4): the IPv4 address sits in groups 1 and 2.
  if (g0 === 0x2002) {
    const v4 = [g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff].join('.');
    return withContext(checkIPv4(v4), address);
  }

  const normalized = groups.map((g) => g.toString(16)).join(':');
  const hit = V6.find(({ list }) => list.check(normalized, 'ipv6'));
  return hit ? { allowed: false, reason: `${address} is ${hit.label}` } : { allowed: true };
}

function withContext(verdict: AddressVerdict, original: string): AddressVerdict {
  return verdict.allowed
    ? verdict
    : { allowed: false, reason: `${original} embeds ${verdict.reason}` };
}
