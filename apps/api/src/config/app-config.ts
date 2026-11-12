import { envList, resolveAllowPrivateDestinations } from '@hookline/shared';
import { parseEncryptionKey } from '@hookline/db';
import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** BullMQ key prefix; must match the dispatcher's. */
  queuePrefix: string;
  encryptionKey: Buffer;
  adminPasswordHash: string;
  sessionSecret: string;
  publicIngestBaseUrl: string;
  redactHeaders: string[];
  allowPrivateDestinations: boolean;
  maxBodyBytes: number;
}

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  HOOKLINE_ENCRYPTION_KEY: z.string().min(1),
  ADMIN_PASSWORD_HASH: z
    .string()
    .trim()
    .startsWith('scrypt$', 'must be generated with `pnpm --filter @hookline/api hash-password`'),
  QUEUE_PREFIX: z.string().min(1).default('hookline'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  PUBLIC_INGEST_BASE_URL: z.string().url().default('http://localhost:4000'),
  REDACT_HEADERS: envList.default(''),
  ALLOW_PRIVATE_DESTINATIONS: z.string().optional(),
});

/** 256 KB, per the spec. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Validates the environment once at startup and fails fast with every problem listed. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.API_PORT,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    encryptionKey: parseEncryptionKey(e.HOOKLINE_ENCRYPTION_KEY),
    adminPasswordHash: e.ADMIN_PASSWORD_HASH,
    queuePrefix: e.QUEUE_PREFIX,
    sessionSecret: e.SESSION_SECRET,
    publicIngestBaseUrl: e.PUBLIC_INGEST_BASE_URL.replace(/\/+$/, ''),
    redactHeaders: e.REDACT_HEADERS,
    allowPrivateDestinations: resolveAllowPrivateDestinations(
      e.ALLOW_PRIVATE_DESTINATIONS,
      e.NODE_ENV,
    ),
    maxBodyBytes: MAX_BODY_BYTES,
  };
}
