/** BullMQ queue that carries delivery attempts. */
export const DELIVERY_QUEUE = 'deliveries';

export interface DeliveryJobData {
  deliveryId: string;
  /** 1-based attempt number this job runs. */
  attempt: number;
}

/**
 * Deterministic job id, so enqueuing the same attempt twice (for example after a relay crash
 * between enqueue and marking the outbox event published) is ignored by BullMQ.
 */
export function deliveryJobId(job: DeliveryJobData): string {
  return `${job.deliveryId}-a${job.attempt}`;
}
