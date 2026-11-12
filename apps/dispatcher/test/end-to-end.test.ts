import { DeliveryStatus } from '@hookline/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StaleDeliveryRecovery } from '../src/delivery/stale-delivery-recovery';
import { createIngestedRequest } from './fixtures';
import { StubServer, waitFor } from './stub-server';
import { createTestDispatcher, type TestDispatcher } from './test-dispatcher';
import { resetDatabase } from './test-db';

let t: TestDispatcher;
let stub: StubServer;
let url: string;

beforeEach(async () => {
  t = await createTestDispatcher({ runBackgroundWork: true });
  await resetDatabase(t.prisma);
  stub = new StubServer();
  url = await stub.start();
});

afterEach(async () => {
  await t.app.close();
  await stub.stop();
});

const waitForStatus = (id: string, status: DeliveryStatus) =>
  waitFor(async () => {
    const d = await t.prisma.delivery.findUniqueOrThrow({
      where: { id },
      include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
    });
    return d.status === status ? d : null;
  });

describe('dispatcher end to end', () => {
  it('retries a failing destination until it succeeds', async () => {
    stub.respondWith({ status: 500 }, { status: 502 });
    const { delivery } = await createIngestedRequest(t.prisma, { url });
    const done = await waitForStatus(delivery.id, DeliveryStatus.SUCCEEDED);
    expect(done.attempts.map((a) => a.responseStatus)).toEqual([500, 502, 200]);
    expect(stub.received.map((r) => r.headers['x-hookline-attempt'])).toEqual(['1', '2', '3']);
  });

  it('dead-letters after maxAttempts', async () => {
    stub.setFallback({ status: 503 });
    const { delivery } = await createIngestedRequest(t.prisma, { url, maxAttempts: 3 });
    const dead = await waitForStatus(delivery.id, DeliveryStatus.DEAD);
    expect(dead.attemptCount).toBe(3);
    expect(dead.attempts).toHaveLength(3);
    expect(stub.received).toHaveLength(3);
  });

  it('recovers a delivery left IN_FLIGHT by a crashed worker', async () => {
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
    // Simulate a worker that claimed attempt 1 and died ten minutes ago.
    await t.prisma.$executeRaw`
      UPDATE "Delivery" SET "status" = 'IN_FLIGHT', "attemptCount" = 1,
        "updatedAt" = now() - interval '10 minutes'
      WHERE "id" = ${delivery.id}::uuid`;

    expect(await t.app.get(StaleDeliveryRecovery).recover()).toBe(1);
    const done = await waitForStatus(delivery.id, DeliveryStatus.SUCCEEDED);
    expect(done.attempts[0]?.error).toMatch(/interrupted/);
    expect(done.attempts[1]?.responseStatus).toBe(200);
  });
});
