import { randomBytes, scryptSync } from 'node:crypto';

/** Everything the E2E stack needs. Ports differ from the dev defaults so both can run at once. */
export const E2E = {
  apiPort: 4100,
  webPort: 3100,
  stubPort: 4110,
  password: 'e2e-admin-password',
  databaseUrl:
    process.env.E2E_DATABASE_URL ?? 'postgresql://hookline:hookline@localhost:5432/hookline_e2e',
  redisUrl: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379',
} as const;

/** Same format as `pnpm --filter @hookline/api hash-password`. */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1 });
  return ['scrypt', 16_384, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Environment shared by the API, dispatcher and web servers. Generated per run, never stored. */
export function serverEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: E2E.databaseUrl,
    REDIS_URL: E2E.redisUrl,
    QUEUE_PREFIX: `hookline-e2e-${randomBytes(4).toString('hex')}`,
    HOOKLINE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ADMIN_PASSWORD_HASH: hashPassword(E2E.password),
    SESSION_SECRET: randomBytes(32).toString('hex'),
    API_PORT: String(E2E.apiPort),
    PUBLIC_INGEST_BASE_URL: `http://localhost:${E2E.apiPort}`,
    API_URL: `http://localhost:${E2E.apiPort}`,
    // The stub destination listens on localhost.
    ALLOW_PRIVATE_DESTINATIONS: 'true',
    // Short backoff so the retry happens within the test.
    RETRY_BASE_MS: '500',
    RETRY_CAP_MS: '2000',
    OUTBOX_POLL_MS: '100',
    STUB_PORT: String(E2E.stubPort),
  };
}
