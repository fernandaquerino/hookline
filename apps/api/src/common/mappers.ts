import type {
  Delivery,
  DeliveryAttempt,
  Destination,
  Endpoint,
  InboundRequest,
} from '@hookline/db';
import type {
  AttemptDto,
  DeliveryDetailDto,
  DeliverySummaryDto,
  DestinationDto,
  EndpointDto,
  RequestSummaryDto,
} from '@hookline/shared';

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toDestinationDto(destination: Destination): DestinationDto {
  return {
    id: destination.id,
    endpointId: destination.endpointId,
    url: destination.url,
    enabled: destination.enabled,
    timeoutMs: destination.timeoutMs,
    maxAttempts: destination.maxAttempts,
    createdAt: destination.createdAt.toISOString(),
  };
}

export function toEndpointDto(
  endpoint: Endpoint & { destinations: Destination[] },
  ingestBaseUrl: string,
  lastRequestAt: Date | null,
): EndpointDto {
  return {
    id: endpoint.id,
    name: endpoint.name,
    slug: endpoint.slug,
    ingestUrl: `${ingestBaseUrl}/in/${endpoint.slug}`,
    signingScheme: endpoint.signingScheme,
    hasSigningSecret: endpoint.signingSecretEnc !== null,
    dedupeHeader: endpoint.dedupeHeader,
    forwardInvalidSignatures: endpoint.forwardInvalidSignatures,
    createdAt: endpoint.createdAt.toISOString(),
    lastRequestAt: iso(lastRequestAt),
    destinations: endpoint.destinations.map(toDestinationDto),
  };
}

export function toDeliverySummaryDto(delivery: Delivery): DeliverySummaryDto {
  return {
    id: delivery.id,
    destinationId: delivery.destinationId,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    nextAttemptAt: iso(delivery.nextAttemptAt),
    replayOfId: delivery.replayOfId,
    createdAt: delivery.createdAt.toISOString(),
  };
}

export function toAttemptDto(attempt: DeliveryAttempt): AttemptDto {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt.toISOString(),
    durationMs: attempt.durationMs,
    responseStatus: attempt.responseStatus,
    responseBodySnippet: attempt.responseBodySnippet,
    error: attempt.error,
  };
}

export function toDeliveryDetailDto(
  delivery: Delivery & { destination: Destination; attempts: DeliveryAttempt[] },
): DeliveryDetailDto {
  return {
    ...toDeliverySummaryDto(delivery),
    destinationUrl: delivery.destination.url,
    attempts: delivery.attempts.map(toAttemptDto),
  };
}

/** Request summary; `sizeBytes` is passed in so list queries need not load the body. */
export function toRequestSummaryDto(
  request: Omit<InboundRequest, 'body' | 'headers'> & { deliveries: Delivery[] },
  sizeBytes: number,
): RequestSummaryDto {
  return {
    id: request.id,
    endpointId: request.endpointId,
    method: request.method,
    contentType: request.contentType,
    sizeBytes,
    signatureStatus: request.signatureStatus,
    receivedAt: request.receivedAt.toISOString(),
    deliveries: request.deliveries.map(toDeliverySummaryDto),
  };
}
