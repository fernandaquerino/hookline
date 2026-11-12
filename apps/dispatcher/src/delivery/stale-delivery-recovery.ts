import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeliveryStatus } from '@hookline/db';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryProcessor } from './delivery-processor';

/**
 * Finds deliveries stuck IN_FLIGHT (the worker died mid-attempt) and records the interrupted
 * attempt as a network failure, which schedules a retry or dead-letters as usual.
 */
@Injectable()
export class StaleDeliveryRecovery {
  private readonly logger = new Logger(StaleDeliveryRecovery.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: DeliveryProcessor,
    @Inject(DISPATCHER_CONFIG) private readonly config: DispatcherConfig,
  ) {}

  async recover(nowMs: number = Date.now()): Promise<number> {
    const stale = await this.prisma.delivery.findMany({
      where: {
        status: DeliveryStatus.IN_FLIGHT,
        updatedAt: { lt: new Date(nowMs - this.config.staleInFlightMs) },
      },
      include: { destination: { select: { maxAttempts: true } } },
      take: 100,
    });
    let recovered = 0;
    for (const delivery of stale) {
      const result = {
        kind: 'error',
        error: 'Attempt interrupted: the dispatcher stopped before it completed',
        durationMs: 0,
        blocked: false,
      } as const;
      const step = this.processor.plan(
        delivery.attemptCount,
        delivery.destination.maxAttempts,
        result,
      );
      const done = await this.processor.record(
        { deliveryId: delivery.id, attempt: delivery.attemptCount },
        {
          startedAt: delivery.updatedAt,
          durationMs: null,
          responseStatus: null,
          responseBodySnippet: null,
          error: result.error,
        },
        step,
      );
      if (done) recovered++;
    }
    if (recovered > 0) this.logger.warn(`Recovered ${recovered} interrupted deliveries`);
    return recovered;
  }
}
