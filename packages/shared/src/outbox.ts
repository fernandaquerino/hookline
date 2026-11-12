import { z } from 'zod';

/** Transactional outbox event types written by the API and the dispatcher. */
export const OutboxEventType = {
  /** A request was stored; enqueue the first attempt of each listed delivery. */
  REQUEST_RECEIVED: 'request.received',
  /** A delivery needs an attempt at `notBefore` (retries and replays). */
  DELIVERY_SCHEDULED: 'delivery.scheduled',
} as const;

export type OutboxEventType = (typeof OutboxEventType)[keyof typeof OutboxEventType];

export const requestReceivedPayload = z.object({
  requestId: z.string().uuid(),
  endpointId: z.string().uuid(),
  deliveryIds: z.array(z.string().uuid()),
});
export type RequestReceivedPayload = z.infer<typeof requestReceivedPayload>;

export const deliveryScheduledPayload = z.object({
  deliveryId: z.string().uuid(),
  /** 1-based number of the attempt to run. */
  attempt: z.number().int().positive(),
  /** ISO timestamp; the attempt must not run before this time. */
  notBefore: z.string().datetime(),
});
export type DeliveryScheduledPayload = z.infer<typeof deliveryScheduledPayload>;
