import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Redis } from 'ioredis';
import { assertTestDatabase } from './test-db';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './test-env';

/** Applies migrations to the test database before the tests; removes test queues afterwards. */
export default function setup(): () => Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  const require = createRequire(__filename);
  const dbPackage = path.dirname(require.resolve('@hookline/db/package.json'));
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [dbPackage] });
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });

  return async () => {
    const redis = new Redis(TEST_REDIS_URL);
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', 'hookline-test-*', 'COUNT', 1000);
        cursor = next;
        if (keys.length > 0) await redis.unlink(...keys);
      } while (cursor !== '0');
    } finally {
      redis.disconnect();
    }
  };
}
