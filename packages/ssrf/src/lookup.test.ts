import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import { DestinationNotAllowedError, isDestinationNotAllowed } from './errors';
import { assertDestinationAllowed } from './index';
import { createGuardedLookup, resolvePublicAddresses, type Resolver } from './lookup';

const fixed =
  (...addresses: LookupAddress[]): Resolver =>
  async () =>
    addresses;

/** Answers with a public address first, then a private one: a DNS rebinding attack. */
function rebinding(): Resolver {
  let calls = 0;
  return async () =>
    calls++ === 0
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }];
}

function lookupAsync(
  lookup: ReturnType<typeof createGuardedLookup>,
  hostname: string,
  options: { all?: boolean; family?: number } = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    lookup(hostname, options as never, (error, address, family) =>
      error ? reject(error) : resolve(options.all ? address : { address, family }),
    );
  });
}

describe('resolvePublicAddresses', () => {
  it('returns public addresses', async () => {
    await expect(
      resolvePublicAddresses('hooks.example.com', fixed({ address: '93.184.216.34', family: 4 })),
    ).resolves.toHaveLength(1);
  });

  it('rejects if any address is private, even mixed with public ones', async () => {
    const resolver = fixed(
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    );
    await expect(resolvePublicAddresses('mixed.example.com', resolver)).rejects.toThrow(
      /resolves to 10\.0\.0\.5 is private/,
    );
  });

  it('rejects private IPv6 answers', async () => {
    await expect(
      resolvePublicAddresses('v6.example.com', fixed({ address: 'fd00::1', family: 6 })),
    ).rejects.toBeInstanceOf(DestinationNotAllowedError);
  });

  it('rejects an empty answer', async () => {
    await expect(resolvePublicAddresses('empty.example.com', fixed())).rejects.toThrow(
      /did not resolve/,
    );
  });
});

describe('createGuardedLookup', () => {
  it('returns the checked address in single and all modes', async () => {
    const lookup = createGuardedLookup({
      allowPrivate: false,
      resolver: fixed(
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800::1', family: 6 },
      ),
    });
    await expect(lookupAsync(lookup, 'h')).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    });
    await expect(lookupAsync(lookup, 'h', { all: true })).resolves.toHaveLength(2);
    await expect(lookupAsync(lookup, 'h', { family: 6 })).resolves.toEqual({
      address: '2606:2800::1',
      family: 6,
    });
  });

  it('fails with a DESTINATION_NOT_ALLOWED error for private answers', async () => {
    const lookup = createGuardedLookup({
      allowPrivate: false,
      resolver: fixed({ address: '169.254.169.254', family: 4 }),
    });
    const error = await lookupAsync(lookup, 'metadata.example.com').catch((e: unknown) => e);
    expect(isDestinationNotAllowed(error)).toBe(true);
  });

  it('allows private answers when configured', async () => {
    const lookup = createGuardedLookup({
      allowPrivate: true,
      resolver: fixed({ address: '127.0.0.1', family: 4 }),
    });
    await expect(lookupAsync(lookup, 'localhost')).resolves.toEqual({
      address: '127.0.0.1',
      family: 4,
    });
  });

  it('catches DNS rebinding: a host that was public on save is refused at delivery', async () => {
    const resolver = rebinding();
    // Save time: the hostname resolves to a public address and passes.
    await expect(
      assertDestinationAllowed('https://rebind.example.com/hook', {
        allowPrivate: false,
        resolver,
      }),
    ).resolves.toBeUndefined();
    // Delivery time: the same hostname now resolves to loopback and the connect-time lookup refuses.
    const lookup = createGuardedLookup({ allowPrivate: false, resolver });
    await expect(lookupAsync(lookup, 'rebind.example.com')).rejects.toThrow(
      /127\.0\.0\.1 is loopback/,
    );
  });
});

describe('isDestinationNotAllowed', () => {
  it('finds the guard error in a cause chain', () => {
    const wrapped = new Error('fetch failed', {
      cause: new Error('connect failed', { cause: new DestinationNotAllowedError('nope') }),
    });
    expect(isDestinationNotAllowed(wrapped)).toBe(true);
    expect(isDestinationNotAllowed(new Error('other'))).toBe(false);
  });
});
