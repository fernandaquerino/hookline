import type { DeliveryStatusName, SignatureStatusName, SigningSchemeName } from './schemas';

/** JSON shapes returned by the management API. Dates are ISO strings. */

export interface DestinationDto {
  id: string;
  endpointId: string;
  url: string;
  enabled: boolean;
  timeoutMs: number;
  maxAttempts: number;
  createdAt: string;
}

export interface EndpointDto {
  id: string;
  name: string;
  slug: string;
  ingestUrl: string;
  signingScheme: SigningSchemeName;
  hasSigningSecret: boolean;
  dedupeHeader: string | null;
  forwardInvalidSignatures: boolean;
  createdAt: string;
  lastRequestAt: string | null;
  destinations: DestinationDto[];
}

export interface DeliverySummaryDto {
  id: string;
  destinationId: string;
  status: DeliveryStatusName;
  attemptCount: number;
  nextAttemptAt: string | null;
  replayOfId: string | null;
  createdAt: string;
}

export interface RequestSummaryDto {
  id: string;
  endpointId: string;
  method: string;
  contentType: string | null;
  sizeBytes: number;
  signatureStatus: SignatureStatusName;
  receivedAt: string;
  deliveries: DeliverySummaryDto[];
}

export interface AttemptDto {
  id: string;
  attemptNumber: number;
  startedAt: string;
  durationMs: number | null;
  responseStatus: number | null;
  responseBodySnippet: string | null;
  error: string | null;
}

export interface DeliveryDetailDto extends DeliverySummaryDto {
  destinationUrl: string;
  attempts: AttemptDto[];
}

export interface RequestDetailDto extends Omit<RequestSummaryDto, 'deliveries'> {
  endpoint: { id: string; name: string; signingScheme: SigningSchemeName };
  path: string;
  query: string;
  headers: Record<string, string>;
  /** Raw body, base64 encoded (it may be binary). */
  bodyBase64: string;
  dedupeKey: string | null;
  deliveries: DeliveryDetailDto[];
}

export interface DeadLetterDto extends DeliverySummaryDto {
  destinationUrl: string;
  request: { id: string; method: string; receivedAt: string };
  endpoint: { id: string; name: string };
  lastError: string | null;
  lastResponseStatus: number | null;
  /** True once a replay of this delivery has been created. */
  replayed: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ReplayResultDto {
  deliveries: DeliverySummaryDto[];
}

export interface BulkReplayResultDto {
  replayed: DeliverySummaryDto[];
  skipped: Array<{ deliveryId: string; code: string; message: string }>;
}

export interface HealthDto {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  redis: 'ok' | 'error';
  outbox: { unpublished: number; oldestAgeMs: number | null } | null;
  queue: { waiting: number; delayed: number; active: number; failed: number } | null;
}
