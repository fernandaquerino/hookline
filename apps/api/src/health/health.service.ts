import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { DELIVERY_QUEUE, type HealthDto } from '@hookline/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.connection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    this.connection.on('error', () => undefined);
    this.queue = new Queue(DELIVERY_QUEUE, {
      connection: this.connection,
      prefix: config.queuePrefix,
    });
  }

  async check(): Promise<HealthDto> {
    const [outbox, queue] = await Promise.all([this.outbox(), this.queueDepth()]);
    const database = outbox ? 'ok' : 'error';
    const redis = queue ? 'ok' : 'error';
    return {
      status: database === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      database,
      redis,
      outbox,
      queue,
    };
  }

  /** Outbox lag: how many events wait to be relayed, and how old the oldest one is. */
  private async outbox(): Promise<HealthDto['outbox']> {
    try {
      const [row] = await this.prisma.$queryRaw<Array<{ count: bigint; oldest: Date | null }>>`
        SELECT count(*) AS count, min("createdAt") AS oldest
        FROM "OutboxEvent" WHERE "publishedAt" IS NULL`;
      return {
        unpublished: Number(row?.count ?? 0),
        oldestAgeMs: row?.oldest ? Math.max(0, Date.now() - row.oldest.getTime()) : null,
      };
    } catch {
      return null;
    }
  }

  private async queueDepth(): Promise<HealthDto['queue']> {
    try {
      if (this.connection.status === 'wait') await this.connection.connect();
      const counts = await this.queue.getJobCounts('waiting', 'delayed', 'active', 'failed');
      return {
        waiting: counts.waiting ?? 0,
        delayed: counts.delayed ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
      };
    } catch {
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
