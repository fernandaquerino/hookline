import { isIPv4, isIPv6 } from 'node:net';

/** Expands an IPv6 address (including an embedded dotted IPv4 tail) to eight 16-bit groups. */
export function expandIPv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!isIPv6(text)) return null;

  // Convert a trailing dotted quad (::ffff:1.2.3.4) into two hex groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map(Number);
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head = '', rest] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = rest === undefined ? [] : rest ? rest.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups =
    rest === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** Returns the IPv4 address embedded in the last 32 bits of an IPv6 address. */
export function embeddedIPv4(groups: number[]): string {
  const hi = groups[6] ?? 0;
  const lo = groups[7] ?? 0;
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

export function ipFamily(address: string): 4 | 6 | 0 {
  if (isIPv4(address)) return 4;
  if (isIPv6(address.split('%')[0] ?? '')) return 6;
  return 0;
}
