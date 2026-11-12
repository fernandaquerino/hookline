import { Injectable } from '@nestjs/common';
import type { Prisma } from '@hookline/db';
import {
  ErrorCode,
  type ListRequestsQuery,
  type Page,
  type RequestDetailDto,
  type RequestSummaryDto,
} from '@hookline/shared';
import { ApiException } from '../common/api-exception';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { toDeliveryDetailDto, toRequestSummaryDto } from '../common/mappers';
import { EndpointsService } from '../endpoints/endpoints.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly endpoints: EndpointsService,
  ) {}

  /** Newest first, keyset-paginated on (receivedAt, id). */
  async list(endpointId: string, query: ListRequestsQuery): Promise<Page<RequestSummaryDto>> {
    await this.endpoints.assertExists(endpointId);
    const cursor = decodeCursor(query.cursor);
    const where: Prisma.InboundRequestWhereInput = {
      endpointId,
      signatureStatus: query.signatureStatus,
      deliveries: query.deliveryStatus ? { some: { status: query.deliveryStatus } } : undefined,
      OR: cursor
        ? [{ receivedAt: { lt: cursor.at } }, { receivedAt: cursor.at, id: { lt: cursor.id } }]
        : undefined,
    };
    const rows = await this.prisma.inboundRequest.findMany({
      where,
      omit: { body: true, headers: true },
      include: { deliveries: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => toRequestSummaryDto(row, row.bodySize)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ at: last.receivedAt, id: last.id })
          : null,
    };
  }

  async get(id: string): Promise<RequestDetailDto> {
    const request = await this.prisma.inboundRequest.findUnique({
      where: { id },
      include: {
        endpoint: { select: { id: true, name: true, signingScheme: true } },
        deliveries: {
          orderBy: { createdAt: 'asc' },
          include: { destination: true, attempts: { orderBy: { attemptNumber: 'asc' } } },
        },
      },
    });
    if (!request) {
      throw ApiException.notFound(ErrorCode.REQUEST_NOT_FOUND, `No request with id ${id}`);
    }
    const body = Buffer.from(request.body);
    return {
      ...toRequestSummaryDto({ ...request, deliveries: [] }, body.length),
      endpoint: request.endpoint,
      path: request.path,
      query: request.query,
      headers: request.headers as Record<string, string>,
      bodyBase64: body.toString('base64'),
      dedupeKey: request.dedupeKey,
      deliveries: request.deliveries.map(toDeliveryDetailDto),
    };
  }
}
