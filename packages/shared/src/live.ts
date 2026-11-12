import type { DeliverySummaryDto, RequestSummaryDto } from './dto';

/** Redis pub/sub channel carrying live events for one endpoint. */
export function liveChannel(endpointId: string): string {
  return `hookline:live:${endpointId}`;
}

export const LIVE_CHANNEL_PATTERN = 'hookline:live:*';

export interface RequestReceivedLiveEvent {
  type: 'request.received';
  endpointId: string;
  request: RequestSummaryDto;
}

export interface DeliveryUpdatedLiveEvent {
  type: 'delivery.updated';
  endpointId: string;
  requestId: string;
  delivery: DeliverySummaryDto;
}

export type LiveEvent = RequestReceivedLiveEvent | DeliveryUpdatedLiveEvent;
