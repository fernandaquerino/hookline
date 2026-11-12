import type {
  DeliverySummaryDto,
  DeliveryStatusName,
  LiveEvent,
  RequestSummaryDto,
  SignatureStatusName,
} from '@hookline/shared';

export interface TailFilters {
  signatureStatus: SignatureStatusName | '';
  deliveryStatus: DeliveryStatusName | '';
}

export function matchesFilters(request: RequestSummaryDto, filters: TailFilters): boolean {
  if (filters.signatureStatus && request.signatureStatus !== filters.signatureStatus) return false;
  if (
    filters.deliveryStatus &&
    !request.deliveries.some((d) => d.status === filters.deliveryStatus)
  ) {
    return false;
  }
  return true;
}

function upsertDelivery(
  deliveries: DeliverySummaryDto[],
  delivery: DeliverySummaryDto,
): DeliverySummaryDto[] {
  const index = deliveries.findIndex((d) => d.id === delivery.id);
  if (index === -1) return [...deliveries, delivery];
  const current = deliveries[index];
  // Events can arrive out of order; never move a delivery back to an older attempt.
  if (current && current.attemptCount > delivery.attemptCount) return deliveries;
  const next = [...deliveries];
  next[index] = delivery;
  return next;
}

/** Applies one live event to the newest-first request list. Pure, for easy testing. */
export function applyLiveEvent(
  requests: RequestSummaryDto[],
  event: LiveEvent,
): RequestSummaryDto[] {
  if (event.type === 'request.received') {
    if (requests.some((r) => r.id === event.request.id)) return requests;
    return [event.request, ...requests];
  }
  return requests.map((request) =>
    request.id === event.requestId
      ? { ...request, deliveries: upsertDelivery(request.deliveries, event.delivery) }
      : request,
  );
}

/** Merges a freshly fetched first page into the current list (after a reconnect). */
export function mergeFirstPage(
  current: RequestSummaryDto[],
  fresh: RequestSummaryDto[],
): RequestSummaryDto[] {
  const freshIds = new Set(fresh.map((r) => r.id));
  return [...fresh, ...current.filter((r) => !freshIds.has(r.id))];
}
