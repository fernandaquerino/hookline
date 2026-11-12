import { Injectable } from '@nestjs/common';
import { type Delivery, DeliveryStatus, type Prisma } from '@hookline/db';
import {
  type BulkReplayResultDto,
  type DeliveryScheduledPayload,
  type DeliverySummaryDto,
  ErrorCode,
  OutboxEventType,
} from '@hookline/shared';
import { ApiException } from '../common/api-exception';
import { toDeliverySummaryDto } from '../common/mappers';
import { LiveEventsService } from '../live/live-events.service';
import { PrismaService } from '../prisma/prisma.service';

const IN_PROGRESS: DeliveryStatus[] = [
  DeliveryStatus.PENDING,
  DeliveryStatus.IN_FLIGHT,
  DeliveryStatus.FAILED_RETRYING,
];

type Tx = Prisma.TransactionClient;

/**
 * Replays create new deliveries for an existing request. Past deliveries and their attempts are
 * never changed; the new delivery links back through `replayOfId`.
 */
@Injectable()
export class ReplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveEventsService,
  ) {}

  async replayDelivery(deliveryId: string): Promise<DeliverySummaryDto> {
    const original = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { destination: true, inboundRequest: { select: { endpointId: true } } },
    });
    if (!original) {
      throw ApiException.notFound(
        ErrorCode.DELIVERY_NOT_FOUND,
        `No delivery with id ${deliveryId}`,
      );
    }
    if (IN_PROGRESS.includes(original.status)) {
      throw notReplayable(`Delivery is still ${original.status}; wait for it to finish`);
    }
    if (!original.destination.enabled) {
      throw notReplayable('The destination is disabled');
    }
    const created = await this.prisma.$transaction((tx) =>
      this.createDelivery(tx, original.inboundRequestId, original.destinationId, original.id),
    );
    await this.announce(original.inboundRequest.endpointId, original.inboundRequestId, created);
    return toDeliverySummaryDto(created);
  }

  async replayRequest(endpointId: string, requestId: string): Promise<DeliverySummaryDto[]> {
    const request = await this.prisma.inboundRequest.findFirst({
      where: { id: requestId, endpointId },
      include: { endpoint: { include: { destinations: { where: { enabled: true } } } } },
    });
    if (!request) {
      throw ApiException.notFound(
        ErrorCode.REQUEST_NOT_FOUND,
        `No request ${requestId} on endpoint ${endpointId}`,
      );
    }
    const destinations = request.endpoint.destinations;
    if (destinations.length === 0) throw notReplayable('The endpoint has no enabled destinations');

    const created = await this.prisma.$transaction(async (tx) => {
      const deliveries: Delivery[] = [];
      for (const destination of destinations) {
        deliveries.push(await this.createDelivery(tx, request.id, destination.id, null));
      }
      return deliveries;
    });
    for (const delivery of created) await this.announce(endpointId, request.id, delivery);
    return created.map(toDeliverySummaryDto);
  }

  async replayMany(deliveryIds: string[]): Promise<BulkReplayResultDto> {
    const result: BulkReplayResultDto = { replayed: [], skipped: [] };
    for (const deliveryId of new Set(deliveryIds)) {
      try {
        result.replayed.push(await this.replayDelivery(deliveryId));
      } catch (error) {
        if (!(error instanceof ApiException)) throw error;
        const body = error.getResponse() as { code: string; message: string };
        result.skipped.push({ deliveryId, code: body.code, message: body.message });
      }
    }
    return result;
  }

  private async createDelivery(
    tx: Tx,
    inboundRequestId: string,
    destinationId: string,
    replayOfId: string | null,
  ): Promise<Delivery> {
    const delivery = await tx.delivery.create({
      data: { inboundRequestId, destinationId, replayOfId },
    });
    const payload: DeliveryScheduledPayload = {
      deliveryId: delivery.id,
      attempt: 1,
      notBefore: new Date().toISOString(),
    };
    await tx.outboxEvent.create({
      data: {
        type: OutboxEventType.DELIVERY_SCHEDULED,
        payload: payload satisfies Prisma.InputJsonObject,
      },
    });
    return delivery;
  }

  private announce(endpointId: string, requestId: string, delivery: Delivery): Promise<void> {
    return this.live.publish({
      type: 'delivery.updated',
      endpointId,
      requestId,
      delivery: toDeliverySummaryDto(delivery),
    });
  }
}

function notReplayable(message: string): ApiException {
  return ApiException.conflict(ErrorCode.DELIVERY_NOT_REPLAYABLE, message);
}
