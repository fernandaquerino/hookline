import { DeliveryStatus } from '@hookline/db';
import { type LiveEvent, OutboxEventType, liveChannel } from '@hookline/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DeliveryProcessor } from '../src/delivery/delivery-processor';
import { createIngestedRequest } from './fixtures';
import { StubServer, waitFor } from './stub-server';
import { createTestDispatcher, type TestDispatcher } from './test-dispatcher';
import { resetDatabase } from './test-db';

let t: TestDispatcher;
let processor: DeliveryProcessor;
let stub: StubServer;
let url: string;

beforeAll(async () => {
  // random() = 0.5 makes the jittered delay deterministic: half of the backoff ceiling.
  t = await createTestDispatcher({
    runBackgroundWork: false,
    random: () => 0.5,
    config: { retryBaseMs: 2_000, retryCapMs: 600_000 },
  });
  processor = t.app.get(DeliveryProcessor);
});

afterAll(async () => {
  await t.app.close();
});

beforeEach(async () => {
  await resetDatabase(t.prisma);
  stub = new StubServer();
  url = await stub.start();
});

afterEach(async () => {
  await stub.stop();
});

const loadDelivery = (id: string) =>
  t.prisma.delivery.findUniqueOrThrow({
    where: { id },
    include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
  });

describe('DeliveryProcessor', () => {
  it('forwards method, body and content type with the Hookline headers', async () => {
    const { delivery } = await createIngestedRequest(t.prisma, {
      url,
      method: 'PUT',
      body: '{"hello":"world"}',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-github-event': 'push',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
        authorization: '[redacted]',
      },
    });

    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe('succeeded');

    const [received] = stub.received;
    expect(received?.method).toBe('PUT');
    expect(received?.body.toString()).toBe('{"hello":"world"}');
    expect(received?.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(received?.headers['x-github-event']).toBe('push');
    expect(received?.headers['x-hookline-delivery-id']).toBe(delivery.id);
    expect(received?.headers['x-hookline-attempt']).toBe('1');
    expect(received?.headers.authorization).toBeUndefined();
    expect(received?.headers['transfer-encoding']).toBeUndefined();

    const stored = await loadDelivery(delivery.id);
    expect(stored.status).toBe(DeliveryStatus.SUCCEEDED);
    expect(stored.attemptCount).toBe(1);
    expect(stored.attempts).toHaveLength(1);
    expect(stored.attempts[0]).toMatchObject({
      attemptNumber: 1,
      responseStatus: 200,
      responseBodySnippet: 'ok',
      error: null,
    });
    expect(stored.attempts[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('schedules a retry through the outbox on 5xx', async () => {
    stub.respondWith({ status: 503, body: 'try later' });
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });

    const before = Date.now();
    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe(
      'retry_scheduled',
    );

    const stored = await loadDelivery(delivery.id);
    expect(stored.status).toBe(DeliveryStatus.FAILED_RETRYING);
    expect(stored.attempts[0]).toMatchObject({
      responseStatus: 503,
      responseBodySnippet: 'try later',
    });
    // Full jitter with random 0.5 after attempt 1: 0.5 * 2000 ms.
    const delay = (stored.nextAttemptAt?.getTime() ?? 0) - before;
    expect(delay).toBeGreaterThanOrEqual(900);
    expect(delay).toBeLessThan(1_500);

    const events = await t.prisma.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(OutboxEventType.DELIVERY_SCHEDULED);
    expect(events[0]?.payload).toEqual({
      deliveryId: delivery.id,
      attempt: 2,
      notBefore: stored.nextAttemptAt?.toISOString(),
    });
  });

  it('respects Retry-After on 429', async () => {
    stub.respondWith({ status: 429, headers: { 'retry-after': '30' } });
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
    const before = Date.now();
    await processor.process({ deliveryId: delivery.id, attempt: 1 });
    const stored = await loadDelivery(delivery.id);
    const delay = (stored.nextAttemptAt?.getTime() ?? 0) - before;
    expect(delay).toBeGreaterThanOrEqual(29_000);
    expect(delay).toBeLessThan(31_000);
  });

  it.each([408, 429, 500, 502, 504])('retries status %i', async (status) => {
    stub.respondWith({ status });
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe(
      'retry_scheduled',
    );
  });

  it.each([400, 401, 404, 410, 422, 301])('dead-letters status %i immediately', async (status) => {
    stub.respondWith({ status });
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe('dead');
    const stored = await loadDelivery(delivery.id);
    expect(stored.status).toBe(DeliveryStatus.DEAD);
    expect(stored.nextAttemptAt).toBeNull();
    expect(await t.prisma.outboxEvent.count()).toBe(0);
  });

  it('dead-letters after maxAttempts', async () => {
    stub.setFallback({ status: 500 });
    const { delivery } = await createIngestedRequest(t.prisma, {
      url,
      maxAttempts: 3,
      withOutboxEvent: false,
    });
    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe(
      'retry_scheduled',
    );
    expect(await processor.process({ deliveryId: delivery.id, attempt: 2 })).toBe(
      'retry_scheduled',
    );
    expect(await processor.process({ deliveryId: delivery.id, attempt: 3 })).toBe('dead');
    const stored = await loadDelivery(delivery.id);
    expect(stored.status).toBe(DeliveryStatus.DEAD);
    expect(stored.attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
  });

  it('treats a timeout as retryable and records the error', async () => {
    stub.respondWith({ status: 200, delayMs: 1_000 });
    const { delivery } = await createIngestedRequest(t.prisma, {
      url,
      timeoutMs: 200,
      withOutboxEvent: false,
    });
    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe(
      'retry_scheduled',
    );
    const stored = await loadDelivery(delivery.id);
    expect(stored.attempts[0]).toMatchObject({
      responseStatus: null,
      error: 'Timeout after 200 ms',
    });
  });

  it('treats a refused connection as retryable', async () => {
    await stub.stop();
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
    stub = new StubServer();
    await stub.start();
    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe(
      'retry_scheduled',
    );
    const stored = await loadDelivery(delivery.id);
    expect(stored.attempts[0]?.error).toMatch(/ECONNREFUSED/);
  });

  it('truncates the stored response body to 2 KB', async () => {
    stub.respondWith({ status: 200, body: 'x'.repeat(10_000) });
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
    await processor.process({ deliveryId: delivery.id, attempt: 1 });
    const stored = await loadDelivery(delivery.id);
    expect(stored.attempts[0]?.responseBodySnippet).toHaveLength(2_048);
  });

  it('ignores duplicate and stale jobs', async () => {
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe('succeeded');
    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe('skipped');
    expect(await processor.process({ deliveryId: delivery.id, attempt: 2 })).toBe('skipped');
    expect(stub.received).toHaveLength(1);
  });

  it('processes concurrent duplicate jobs only once', async () => {
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => processor.process({ deliveryId: delivery.id, attempt: 1 })),
    );
    expect(outcomes.filter((o) => o === 'succeeded')).toHaveLength(1);
    expect(stub.received).toHaveLength(1);
  });

  it('dead-letters a delivery whose destination was disabled', async () => {
    const { delivery } = await createIngestedRequest(t.prisma, {
      url,
      enabled: false,
      withOutboxEvent: false,
    });
    expect(await processor.process({ deliveryId: delivery.id, attempt: 1 })).toBe('dead');
    expect(stub.received).toHaveLength(0);
    const stored = await loadDelivery(delivery.id);
    expect(stored.attempts[0]?.error).toBe('Destination is disabled');
  });

  it('publishes IN_FLIGHT and the final status on the endpoint live channel', async () => {
    const { delivery, endpoint } = await createIngestedRequest(t.prisma, {
      url,
      withOutboxEvent: false,
    });
    const subscriber = new Redis(t.config.redisUrl);
    const statuses: string[] = [];
    subscriber.on('message', (_channel: string, message: string) => {
      const event = JSON.parse(message) as LiveEvent;
      if (event.type === 'delivery.updated') statuses.push(event.delivery.status);
    });
    await subscriber.subscribe(liveChannel(endpoint.id));
    try {
      await processor.process({ deliveryId: delivery.id, attempt: 1 });
      await waitFor(async () => statuses.length >= 2, 3_000);
      expect(statuses).toEqual(['IN_FLIGHT', 'SUCCEEDED']);
    } finally {
      subscriber.disconnect();
    }
  });
});
