import { DeliveryStatus } from '@hookline/db';
import { OutboxEventType, deliveryJobId } from '@hookline/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { DeliveryEnqueuer, DeliveryQueue, type ScheduledJob } from '../src/queue/delivery-queue';
import { createIngestedRequest } from './fixtures';
import { StubServer, waitFor } from './stub-server';
import { createTestDispatcher, type TestDispatcher } from './test-dispatcher';
import { resetDatabase } from './test-db';

/** Wraps the real queue and can be told to fail, simulating a crash or Redis outage. */
class CrashingEnqueuer extends DeliveryEnqueuer {
  failNext = 0;
  calls = 0;
  constructor(private readonly real: DeliveryQueue) {
    super();
  }
  async enqueue(jobs: ScheduledJob[]): Promise<void> {
    this.calls++;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('simulated crash before enqueue');
    }
    await this.real.enqueue(jobs);
  }
}

let stub: StubServer;
let url: string;
const contexts: TestDispatcher[] = [];

async function start(runBackgroundWork: boolean, prefix?: string) {
  const ctx = await createTestDispatcher({
    runBackgroundWork,
    config: prefix ? { queuePrefix: prefix } : {},
  });
  contexts.push(ctx);
  return ctx;
}

beforeEach(async () => {
  stub = new StubServer();
  url = await stub.start();
});

afterEach(async () => {
  while (contexts.length) await contexts.pop()?.app.close();
  await stub.stop();
});

describe('OutboxRelayService', () => {
  it('enqueues the first attempt of each delivery and marks the event published', async () => {
    const t = await start(false);
    await resetDatabase(t.prisma);
    const { delivery } = await createIngestedRequest(t.prisma, { url });

    expect(await t.app.get(OutboxRelayService).relayOnce()).toBe(1);

    const event = await t.prisma.outboxEvent.findFirstOrThrow();
    expect(event.publishedAt).not.toBeNull();
    const job = await t.app
      .get(DeliveryQueue)
      .queue.getJob(deliveryJobId({ deliveryId: delivery.id, attempt: 1 }));
    expect(job?.data).toEqual({ deliveryId: delivery.id, attempt: 1 });
    expect(await t.app.get(OutboxRelayService).relayOnce()).toBe(0);
  });

  it('enqueues scheduled retries with the remaining delay', async () => {
    const t = await start(false);
    await resetDatabase(t.prisma);
    const { delivery } = await createIngestedRequest(t.prisma, { url, withOutboxEvent: false });
    const now = Date.now();
    await t.prisma.outboxEvent.create({
      data: {
        type: OutboxEventType.DELIVERY_SCHEDULED,
        payload: {
          deliveryId: delivery.id,
          attempt: 2,
          notBefore: new Date(now + 60_000).toISOString(),
        },
      },
    });
    await t.app.get(OutboxRelayService).relayOnce(now);
    const job = await t.app
      .get(DeliveryQueue)
      .queue.getJob(deliveryJobId({ deliveryId: delivery.id, attempt: 2 }));
    expect(job?.opts.delay).toBe(60_000);
  });

  it('marks unknown and malformed events published so they cannot block the outbox', async () => {
    const t = await start(false);
    await resetDatabase(t.prisma);
    await t.prisma.outboxEvent.createMany({
      data: [
        { type: 'something.else', payload: {} },
        { type: OutboxEventType.REQUEST_RECEIVED, payload: { nope: true } },
      ],
    });
    expect(await t.app.get(OutboxRelayService).relayOnce()).toBe(2);
    expect(await t.prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it('keeps events unpublished when enqueueing fails, and delivers them on the next run', async () => {
    const t = await start(false);
    await resetDatabase(t.prisma);
    const crashing = new CrashingEnqueuer(t.app.get(DeliveryQueue));
    const relay = new OutboxRelayService(t.prisma, crashing, t.config);
    const { delivery } = await createIngestedRequest(t.prisma, { url });

    crashing.failNext = 1;
    await expect(relay.relayOnce()).rejects.toThrow('simulated crash');
    expect(await t.prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(1);

    expect(await relay.relayOnce()).toBe(1);
    expect(
      await t.app
        .get(DeliveryQueue)
        .queue.getJob(deliveryJobId({ deliveryId: delivery.id, attempt: 1 })),
    ).toBeTruthy();
  });
});

describe('crash between commit and enqueue', () => {
  it('delivers a request committed while no dispatcher was running', async () => {
    // The ingest transaction commits, then the process that should enqueue dies: the only trace
    // left is the unpublished outbox event.
    const writer = await start(false);
    await resetDatabase(writer.prisma);
    const { delivery } = await createIngestedRequest(writer.prisma, { url });
    expect(await writer.prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(1);
    await writer.app.close();
    contexts.pop();

    // A fresh dispatcher starts and picks the event up from the outbox.
    const t = await start(true);
    const done = await waitFor(async () => {
      const d = await t.prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      return d.status === DeliveryStatus.SUCCEEDED ? d : null;
    });
    expect(done.attemptCount).toBe(1);
    expect(stub.received).toHaveLength(1);
  });

  it('does not deliver twice when the relay dies after enqueueing but before marking published', async () => {
    const prefix = `hookline-test-${Math.random().toString(36).slice(2)}`;
    const first = await start(false, prefix);
    await resetDatabase(first.prisma);
    const { delivery } = await createIngestedRequest(first.prisma, { url });
    // Enqueue directly without marking the event published: what a crash before commit leaves.
    await first.app
      .get(DeliveryQueue)
      .enqueue([{ deliveryId: delivery.id, attempt: 1, delayMs: 0 }]);

    const t = await start(true, prefix);
    await waitFor(async () => {
      const unpublished = await t.prisma.outboxEvent.count({ where: { publishedAt: null } });
      const d = await t.prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      return unpublished === 0 && d.status === DeliveryStatus.SUCCEEDED;
    });
    // Give a duplicate job time to run if one had been created.
    await new Promise((r) => setTimeout(r, 300));
    expect(stub.received).toHaveLength(1);
    expect(await t.prisma.deliveryAttempt.count({ where: { deliveryId: delivery.id } })).toBe(1);
  });
});
