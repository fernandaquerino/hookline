import { resolveAllowPrivateDestinations } from '@hookline/shared';
import { z } from 'zod';

export const DISPATCHER_CONFIG = Symbol('DISPATCHER_CONFIG');

export interface DispatcherConfig {
  nodeEnv: string;
  databaseUrl: string;
  redisUrl: string;
  /** BullMQ key prefix; tests use a unique one per run. */
  queuePrefix: string;
  allowPrivateDestinations: boolean;
  retryBaseMs: number;
  retryCapMs: number;
  retentionDays: number;
  retentionIntervalMs: number;
  outboxPollMs: number;
  outboxBatchSize: number;
  workerConcurrency: number;
  /** IN_FLIGHT deliveries untouched for longer than this are treated as interrupted. */
  staleInFlightMs: number;
}

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  QUEUE_PREFIX: z.string().min(1).default('hookline'),
  ALLOW_PRIVATE_DESTINATIONS: z.string().optional(),
  RETRY_BASE_MS: z.coerce.number().int().positive().default(2_000),
  RETRY_CAP_MS: z.coerce.number().int().positive().default(600_000),
  RETENTION_DAYS: z.coerce.number().positive().default(7),
  RETENTION_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(60 * 60_000),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(100),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  STALE_IN_FLIGHT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60_000),
});

export function loadDispatcherConfig(env: NodeJS.ProcessEnv = process.env): DispatcherConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;
  if (e.RETRY_BASE_MS > e.RETRY_CAP_MS) {
    throw new Error('Invalid configuration:\n  RETRY_BASE_MS must not exceed RETRY_CAP_MS');
  }
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    queuePrefix: e.QUEUE_PREFIX,
    allowPrivateDestinations: resolveAllowPrivateDestinations(
      e.ALLOW_PRIVATE_DESTINATIONS,
      e.NODE_ENV,
    ),
    retryBaseMs: e.RETRY_BASE_MS,
    retryCapMs: e.RETRY_CAP_MS,
    retentionDays: e.RETENTION_DAYS,
    retentionIntervalMs: e.RETENTION_INTERVAL_MS,
    outboxPollMs: e.OUTBOX_POLL_MS,
    outboxBatchSize: e.OUTBOX_BATCH_SIZE,
    workerConcurrency: e.WORKER_CONCURRENCY,
    staleInFlightMs: e.STALE_IN_FLIGHT_MS,
  };
}
