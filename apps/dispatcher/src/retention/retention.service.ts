import { Inject, Injectable, Logger } from '@nestjs/common';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Published outbox events are only kept briefly, for debugging the relay. */
export const PUBLISHED_OUTBOX_TTL_MS = DAY_MS;

export interface RetentionResult {
  requests: number;
  outboxEvents: number;
}

/**
 * Deletes requests older than RETENTION_DAYS (their deliveries and attempts cascade) and
 * published outbox events older than a day. Deletes run in small batches so a large backlog does
 * not hold long locks. Unpublished outbox events are never deleted.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DISPATCHER_CONFIG) private readonly config: DispatcherConfig,
  ) {}

  async runOnce(nowMs: number = Date.now(), batchSize = 1_000): Promise<RetentionResult> {
    const requestCutoff = new Date(nowMs - this.config.retentionDays * DAY_MS);
    const outboxCutoff = new Date(nowMs - PUBLISHED_OUTBOX_TTL_MS);

    const requests = await this.deleteInBatches(
      batchSize,
      (limit) =>
        this.prisma.$executeRaw`
        DELETE FROM "InboundRequest" WHERE "id" IN (
          SELECT "id" FROM "InboundRequest" WHERE "receivedAt" < ${requestCutoff} LIMIT ${limit}
        )`,
    );
    const outboxEvents = await this.deleteInBatches(
      batchSize,
      (limit) =>
        this.prisma.$executeRaw`
        DELETE FROM "OutboxEvent" WHERE "id" IN (
          SELECT "id" FROM "OutboxEvent"
          WHERE "publishedAt" IS NOT NULL AND "publishedAt" < ${outboxCutoff} LIMIT ${limit}
        )`,
    );

    if (requests > 0 || outboxEvents > 0) {
      this.logger.log(
        `Retention removed ${requests} requests older than ${this.config.retentionDays} days and ${outboxEvents} published outbox events`,
      );
    }
    return { requests, outboxEvents };
  }

  private async deleteInBatches(
    batchSize: number,
    deleteBatch: (limit: number) => Promise<number>,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await deleteBatch(batchSize);
      total += deleted;
      if (deleted < batchSize) return total;
    }
  }
}
