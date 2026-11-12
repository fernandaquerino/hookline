import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { DELIVERY_QUEUE, type DeliveryJobData, deliveryJobId } from '@hookline/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';
import { createRedisConnection } from './redis';

export interface ScheduledJob extends DeliveryJobData {
  /** Milliseconds to wait before the job becomes runnable. */
  delayMs: number;
}

/** Seam used by the outbox relay; tests replace it to simulate crashes. */
export abstract class DeliveryEnqueuer {
  abstract enqueue(jobs: ScheduledJob[]): Promise<void>;
}

@Injectable()
export class DeliveryQueue extends DeliveryEnqueuer implements OnModuleDestroy {
  private readonly connection: Redis;
  readonly queue: Queue<DeliveryJobData>;

  constructor(@Inject(DISPATCHER_CONFIG) config: DispatcherConfig) {
    super();
    this.connection = createRedisConnection(config.redisUrl);
    this.queue = new Queue<DeliveryJobData>(DELIVERY_QUEUE, {
      connection: this.connection,
      prefix: config.queuePrefix,
    });
  }

  async enqueue(jobs: ScheduledJob[]): Promise<void> {
    if (jobs.length === 0) return;
    await this.queue.addBulk(
      jobs.map(({ delayMs, ...data }) => ({
        name: 'deliver',
        data,
        opts: {
          jobId: deliveryJobId(data),
          delay: Math.max(0, Math.round(delayMs)),
          // These retries cover infrastructure failures (database or Redis briefly down) while
          // processing. Destination failures are handled by the delivery's own retry schedule.
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: { age: 3_600, count: 10_000 },
          removeOnFail: { age: 7 * 24 * 3_600 },
        },
      })),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
