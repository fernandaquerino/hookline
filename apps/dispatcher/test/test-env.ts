/** Connection settings for integration tests. Never point these at a database you care about. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://hookline:hookline@localhost:5432/hookline_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
