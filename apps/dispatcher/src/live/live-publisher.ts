import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type LiveEvent, liveChannel } from '@hookline/shared';
import { Redis } from 'ioredis';
import { DISPATCHER_CONFIG, type DispatcherConfig } from '../config/dispatcher-config';
import { PrismaService } from '../prisma/prisma.service';

/** Publishes delivery status changes to the API's live stream. Best effort; never throws. */
@Injectable()
export class LivePublisher implements OnModuleDestroy {
  private readonly logger = new Logger(LivePublisher.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DISPATCHER_CONFIG) config: DispatcherConfig,
  ) {
    this.redis = new Redis(config.redisUrl, { enableOfflineQueue: false });
    this.redis.on('error', (e: Error) => this.logger.warn(`Redis publisher: ${e.message}`));
  }

  /** Reads the delivery's current state and announces it. */
  async deliveryChanged(deliveryId: string): Promise<void> {
    try {
      const delivery = await this.prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: { inboundRequest: { select: { endpointId: true } } },
      });
      if (!delivery) return;
      const event: LiveEvent = {
        type: 'delivery.updated',
        endpointId: delivery.inboundRequest.endpointId,
        requestId: delivery.inboundRequestId,
        delivery: {
          id: delivery.id,
          destinationId: delivery.destinationId,
          status: delivery.status,
          attemptCount: delivery.attemptCount,
          nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
          replayOfId: delivery.replayOfId,
          createdAt: delivery.createdAt.toISOString(),
        },
      };
      await this.redis.publish(liveChannel(event.endpointId), JSON.stringify(event));
    } catch (error) {
      this.logger.warn(`Could not publish live event: ${(error as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
