import { Injectable } from '@nestjs/common';
import type { Prisma } from '@hookline/db';
import type { DeadLetterDto, ListDeliveriesQuery, Page } from '@hookline/shared';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { toDeliverySummaryDto } from '../common/mappers';
import { PrismaService } from '../prisma/prisma.service';

/** Lists deliveries by status (DEAD by default), most recently changed first. */
@Injectable()
export class DeadLettersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListDeliveriesQuery): Promise<Page<DeadLetterDto>> {
    const cursor = decodeCursor(query.cursor);
    const where: Prisma.DeliveryWhereInput = {
      status: query.status,
      OR: cursor
        ? [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }]
        : undefined,
    };
    const rows = await this.prisma.delivery.findMany({
      where,
      include: {
        destination: { select: { url: true } },
        inboundRequest: {
          select: {
            id: true,
            method: true,
            receivedAt: true,
            endpoint: { select: { id: true, name: true } },
          },
        },
        attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 },
        _count: { select: { replays: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        ...toDeliverySummaryDto(row),
        destinationUrl: row.destination.url,
        request: {
          id: row.inboundRequest.id,
          method: row.inboundRequest.method,
          receivedAt: row.inboundRequest.receivedAt.toISOString(),
        },
        endpoint: row.inboundRequest.endpoint,
        lastError: row.attempts[0]?.error ?? null,
        lastResponseStatus: row.attempts[0]?.responseStatus ?? null,
        replayed: row._count.replays > 0,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ at: last.updatedAt, id: last.id })
          : null,
    };
  }
}
