import type { LookupAddress } from 'node:dns';
import { DeliveryStatus } from '@hookline/db';
import type { Resolver } from '@hookline/ssrf';
import { assertDestinationAllowed } from '@hookline/ssrf';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeliveryProcessor } from '../src/delivery/delivery-processor';
import { createIngestedRequest } from './fixtures';
import { StubServer } from './stub-server';
import { createTestDispatcher, type TestDispatcher } from './test-dispatcher';
import { resetDatabase } from './test-db';

/**
 * Fake DNS: `public.test` always resolves to the stub on 127.0.0.1 when private destinations are
 * allowed; `rebind.test` answers a public address on the first lookup (save time) and loopback
 * afterwards (delivery time).
 */
function fakeDns(): Resolver {
  let rebindCalls = 0;
  return async (hostname): Promise<LookupAddress[]> => {
    if (hostname === 'rebind.test') {
      return rebindCalls++ === 0
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }];
    }
    if (hostname === 'loopback.test') return [{ address: '127.0.0.1', family: 4 }];
    if (hostname === 'v6-private.test') return [{ address: '::1', family: 6 }];
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
  };
}

let stub: StubServer;
let port: string;
let t: TestDispatcher;
let resolver: Resolver;

async function start(allowPrivateDestinations: boolean) {
  resolver = fakeDns();
  t = await createTestDispatcher({
    runBackgroundWork: false,
    resolver,
    config: { allowPrivateDestinations },
  });
  await resetDatabase(t.prisma);
}

beforeEach(async () => {
  stub = new StubServer();
  port = new URL(await stub.start()).port;
});

afterEach(async () => {
  await t.app.close();
  await stub.stop();
});

async function deliver(url: string) {
  const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
  const outcome = await t.app
    .get(DeliveryProcessor)
    .process({ deliveryId: delivery.id, attempt: 1 });
  const stored = await t.prisma.delivery.findUniqueOrThrow({
    where: { id: delivery.id },
    include: { attempts: true },
  });
  return { outcome, stored };
}

describe('SSRF guard at delivery time', () => {
  it.each([
    'http://127.0.0.1:PORT/hook',
    'http://[::1]:PORT/hook',
    'http://[::ffff:127.0.0.1]:PORT/hook',
    'http://0x7f000001:PORT/hook',
    'http://localhost:PORT/hook',
    'http://loopback.test:PORT/hook',
    'http://v6-private.test:PORT/hook',
  ])('refuses %s and dead-letters without connecting', async (template) => {
    await start(false);
    const { outcome, stored } = await deliver(template.replace('PORT', port));
    expect(outcome).toBe('dead');
    expect(stored.status).toBe(DeliveryStatus.DEAD);
    expect(stored.attempts[0]?.error).toMatch(/^DESTINATION_NOT_ALLOWED: /);
    expect(stub.received).toHaveLength(0);
  });

  it('catches DNS rebinding between save and delivery', async () => {
    await start(false);
    const url = `http://rebind.test:${port}/hook`;
    // Save-time check sees the public answer and accepts the destination.
    await expect(assertDestinationAllowed(url, { allowPrivate: false, resolver })).resolves.toBe(
      undefined,
    );
    // At delivery the name now points at loopback; the connect-time lookup refuses it.
    const { outcome, stored } = await deliver(url);
    expect(outcome).toBe('dead');
    expect(stored.attempts[0]?.error).toMatch(/rebind\.test resolves to 127\.0\.0\.1 is loopback/);
    expect(stub.received).toHaveLength(0);
  });

  it('delivers to private addresses when ALLOW_PRIVATE_DESTINATIONS is true', async () => {
    await start(true);
    const viaName = await deliver(`http://loopback.test:${port}/hook`);
    expect(viaName.outcome).toBe('succeeded');
    const viaLiteral = await deliver(`http://127.0.0.1:${port}/hook`);
    expect(viaLiteral.outcome).toBe('succeeded');
    expect(stub.received).toHaveLength(2);
  });

  it('treats DNS failures as retryable network errors, not as blocked', async () => {
    await start(false);
    const { outcome, stored } = await deliver('http://unknown-host.test/hook');
    expect(outcome).toBe('retry_scheduled');
    expect(stored.attempts[0]?.error).toMatch(/ENOTFOUND/);
  });
});
