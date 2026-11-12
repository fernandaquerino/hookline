import { Injectable } from '@nestjs/common';
import type { Prisma, SignatureStatus } from '@hookline/db';
import {
  OutboxEventType,
  type RequestReceivedPayload,
  type RequestSummaryDto,
} from '@hookline/shared';
import { toRequestSummaryDto } from '../common/mappers';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';

export interface NewInboundRequest {
  endpointId: string;
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: Buffer;
  contentType: string | null;
  signatureStatus: SignatureStatus;
  dedupeKey: string | null;
  destinationIds: string[];
}

export interface StoredRequest {
  requestId: string;
  deliveryIds: string[];
  summary: RequestSummaryDto;
}

/** Persistence for ingest: request, deliveries and outbox event in one transaction. */
@Injectable()
export class IngestStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores the request with one delivery per destination and a `request.received` outbox event,
   * atomically. Returns null when the dedupe key was already used for this endpoint.
   */
  async store(input: NewInboundRequest): Promise<StoredRequest | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.inboundRequest.create({
          data: {
            endpointId: input.endpointId,
            method: input.method,
            path: input.path,
            query: input.query,
            headers: input.headers,
            // Prisma's Bytes type requires a Uint8Array backed by a plain ArrayBuffer.
            body: new Uint8Array(input.body),
            bodySize: input.body.length,
            contentType: input.contentType,
            signatureStatus: input.signatureStatus,
            dedupeKey: input.dedupeKey,
          },
          omit: { body: true, headers: true },
        });
        const deliveries = await tx.delivery.createManyAndReturn({
          data: input.destinationIds.map((destinationId) => ({
            inboundRequestId: request.id,
            destinationId,
          })),
        });
        const deliveryIds = deliveries.map((d) => d.id);
        const payload: RequestReceivedPayload = {
          requestId: request.id,
          endpointId: input.endpointId,
          deliveryIds,
        };
        await tx.outboxEvent.create({
          data: {
            type: OutboxEventType.REQUEST_RECEIVED,
            payload: payload satisfies Prisma.InputJsonObject,
          },
        });
        return {
          requestId: request.id,
          deliveryIds,
          summary: toRequestSummaryDto({ ...request, deliveries }, input.body.length),
        };
      });
    } catch (error) {
      if (input.dedupeKey !== null && isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async findByDedupeKey(endpointId: string, dedupeKey: string): Promise<string | null> {
    const existing = await this.prisma.inboundRequest.findUnique({
      where: { endpointId_dedupeKey: { endpointId, dedupeKey } },
      select: { id: true },
    });
    return existing?.id ?? null;
  }
}
