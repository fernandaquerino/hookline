import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RetentionService } from '../src/retention/retention.service';
import { createIngestedRequest } from './fixtures';
import { createTestDispatcher, type TestDispatcher } from './test-dispatcher';
import { resetDatabase } from './test-db';

const DAY = 24 * 60 * 60 * 1000;
let t: TestDispatcher;
let retention: RetentionService;

beforeAll(async () => {
  t = await createTestDispatcher({ runBackgroundWork: false, config: { retentionDays: 7 } });
  retention = t.app.get(RetentionService);
});

afterAll(async () => {
  await t.app.close();
});

beforeEach(async () => {
  await resetDatabase(t.prisma);
});

async function requestReceivedDaysAgo(days: number) {
  const created = await createIngestedRequest(t.prisma, { url: 'http://127.0.0.1:9/x' });
  await t.prisma.inboundRequest.update({
    where: { id: created.request.id },
    data: { receivedAt: new Date(Date.now() - days * DAY) },
  });
  await t.prisma.deliveryAttempt.create({
    data: {
      deliveryId: created.delivery.id,
      attemptNumber: 1,
      startedAt: new Date(),
      responseStatus: 500,
    },
  });
  return created;
}

describe('RetentionService', () => {
  it('deletes requests older than RETENTION_DAYS with their deliveries and attempts', async () => {
    const old = await requestReceivedDaysAgo(8);
    const recent = await requestReceivedDaysAgo(6);

    const result = await retention.runOnce();

    expect(result.requests).toBe(1);
    expect(await t.prisma.inboundRequest.findUnique({ where: { id: old.request.id } })).toBeNull();
    expect(await t.prisma.delivery.findUnique({ where: { id: old.delivery.id } })).toBeNull();
    expect(await t.prisma.deliveryAttempt.count({ where: { deliveryId: old.delivery.id } })).toBe(
      0,
    );
    expect(
      await t.prisma.inboundRequest.findUnique({ where: { id: recent.request.id } }),
    ).not.toBeNull();
    expect(
      await t.prisma.deliveryAttempt.count({ where: { deliveryId: recent.delivery.id } }),
    ).toBe(1);
    // Endpoints and destinations are configuration and are kept.
    expect(await t.prisma.endpoint.count()).toBe(2);
  });

  it('removes old published outbox events but never unpublished ones', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * DAY);
    await t.prisma.outboxEvent.createMany({
      data: [
        { type: 'x', payload: {}, createdAt: twoDaysAgo, publishedAt: twoDaysAgo },
        { type: 'x', payload: {}, createdAt: twoDaysAgo, publishedAt: null },
        { type: 'x', payload: {}, publishedAt: new Date() },
      ],
    });
    const result = await retention.runOnce();
    expect(result.outboxEvents).toBe(1);
    expect(await t.prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(1);
    expect(await t.prisma.outboxEvent.count()).toBe(2);
  });

  it('works through a backlog in batches', async () => {
    for (let i = 0; i < 5; i++) await requestReceivedDaysAgo(30);
    const result = await retention.runOnce(Date.now(), 2);
    expect(result.requests).toBe(5);
    expect(await t.prisma.inboundRequest.count()).toBe(0);
  });

  it('honours a custom retention window', async () => {
    const short = await createTestDispatcher({
      runBackgroundWork: false,
      config: { retentionDays: 1 },
    });
    try {
      await requestReceivedDaysAgo(2);
      expect((await short.app.get(RetentionService).runOnce()).requests).toBe(1);
    } finally {
      await short.app.close();
    }
  });
});
