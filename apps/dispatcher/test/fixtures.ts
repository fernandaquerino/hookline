import type { PrismaClient } from '@hookline/db';
import { OutboxEventType } from '@hookline/shared';

export interface FixtureOptions {
  url: string;
  maxAttempts?: number;
  timeoutMs?: number;
  enabled?: boolean;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  /** Write the request.received outbox event, as the API's ingest transaction does. */
  withOutboxEvent?: boolean;
}

/** Creates the same rows the API's ingest transaction would: request, delivery, outbox event. */
export async function createIngestedRequest(prisma: PrismaClient, options: FixtureOptions) {
  const endpoint = await prisma.endpoint.create({
    data: {
      name: 'Dispatcher test',
      slug: `disp-${Math.random().toString(36).slice(2, 10)}`,
      destinations: {
        create: {
          url: options.url,
          maxAttempts: options.maxAttempts ?? 8,
          timeoutMs: options.timeoutMs ?? 2_000,
          enabled: options.enabled ?? true,
        },
      },
    },
    include: { destinations: true },
  });
  const destination = endpoint.destinations[0];
  if (!destination) throw new Error('fixture: destination missing');

  return prisma.$transaction(async (tx) => {
    const request = await tx.inboundRequest.create({
      data: {
        endpointId: endpoint.id,
        method: options.method ?? 'POST',
        path: `/in/${endpoint.slug}`,
        query: '',
        headers: options.headers ?? { 'content-type': 'application/json' },
        body: new Uint8Array(Buffer.from(options.body ?? '{"event":"test"}')),
        contentType: options.headers?.['content-type'] ?? 'application/json',
        signatureStatus: 'not_configured',
      },
    });
    const delivery = await tx.delivery.create({
      data: { inboundRequestId: request.id, destinationId: destination.id },
    });
    if (options.withOutboxEvent !== false) {
      await tx.outboxEvent.create({
        data: {
          type: OutboxEventType.REQUEST_RECEIVED,
          payload: { requestId: request.id, endpointId: endpoint.id, deliveryIds: [delivery.id] },
        },
      });
    }
    return { endpoint, destination, request, delivery };
  });
}
