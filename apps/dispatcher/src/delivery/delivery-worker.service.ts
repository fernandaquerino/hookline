import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DELIVERY_QUEUE, type DeliveryJobData } from '@hookline/shared';
import { type Job, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';
import { createRedisConnection } from '../queue/redis';
import { DeliveryProcessor, type ProcessOutcome } from './delivery-processor';

/** BullMQ worker that hands each delivery job to the processor. */
@Injectable()
export class DeliveryWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DeliveryWorkerService.name);
  private connection: Redis | null = null;
  private worker: Worker<DeliveryJobData, ProcessOutcome> | null = null;

  constructor(
    private readonly processor: DeliveryProcessor,
    @Inject(DISPATCHER_CONFIG) private readonly config: DispatcherConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.connection = createRedisConnection(this.config.redisUrl);
    this.worker = new Worker<DeliveryJobData, ProcessOutcome>(
      DELIVERY_QUEUE,
      (job: Job<DeliveryJobData>) => this.processor.process(job.data),
      {
        connection: this.connection,
        prefix: this.config.queuePrefix,
        concurrency: this.config.workerConcurrency,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Job ${job?.id ?? '?'} failed: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
  }
}
