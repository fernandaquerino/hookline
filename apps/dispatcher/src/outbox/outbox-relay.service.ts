import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OutboxEventType,
  deliveryScheduledPayload,
  requestReceivedPayload,
} from '@hookline/shared';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryEnqueuer, type ScheduledJob } from '../queue/delivery-queue';

interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
}

/**
 * Publishes unpublished outbox events to the delivery queue.
 *
 * Each batch is locked with `FOR UPDATE SKIP LOCKED`, enqueued, then marked published in the same
 * transaction. If enqueueing fails the transaction rolls back and the events are retried on the
 * next run. If the process dies after enqueueing but before commit, the events are enqueued again;
 * deterministic job ids and the worker's conditional claim make that harmless.
 */
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly enqueuer: DeliveryEnqueuer,
    @Inject(DISPATCHER_CONFIG) private readonly config: DispatcherConfig,
  ) {}

  /** Relays one batch. Returns the number of events published. */
  async relayOnce(nowMs: number = Date.now()): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT "id", "type", "payload" FROM "OutboxEvent"
          WHERE "publishedAt" IS NULL
          ORDER BY "createdAt"
          LIMIT ${this.config.outboxBatchSize}
          FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;

        const jobs = rows.flatMap((row) => this.toJobs(row, nowMs));
        await this.enqueuer.enqueue(jobs);
        await tx.outboxEvent.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { publishedAt: new Date(nowMs) },
        });
        return rows.length;
      },
      { timeout: 30_000 },
    );
  }

  /** Relays until the outbox is empty or a batch comes back short. */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const published = await this.relayOnce();
      total += published;
      if (published < this.config.outboxBatchSize) return total;
    }
  }

  private toJobs(row: OutboxRow, nowMs: number): ScheduledJob[] {
    switch (row.type) {
      case OutboxEventType.REQUEST_RECEIVED: {
        const parsed = requestReceivedPayload.safeParse(row.payload);
        if (!parsed.success) return this.skip(row, 'malformed payload');
        return parsed.data.deliveryIds.map((deliveryId) => ({
          deliveryId,
          attempt: 1,
          delayMs: 0,
        }));
      }
      case OutboxEventType.DELIVERY_SCHEDULED: {
        const parsed = deliveryScheduledPayload.safeParse(row.payload);
        if (!parsed.success) return this.skip(row, 'malformed payload');
        const delayMs = Math.max(0, Date.parse(parsed.data.notBefore) - nowMs);
        return [{ deliveryId: parsed.data.deliveryId, attempt: parsed.data.attempt, delayMs }];
      }
      default:
        return this.skip(row, `unknown type "${row.type}"`);
    }
  }

  /** Bad events are marked published (and logged) so they cannot block the outbox forever. */
  private skip(row: OutboxRow, reason: string): ScheduledJob[] {
    this.logger.warn(`Skipping outbox event ${row.id}: ${reason}`);
    return [];
  }
}
