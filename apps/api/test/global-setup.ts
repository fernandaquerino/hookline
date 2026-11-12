import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { assertTestDatabase } from './test-db';
import { TEST_DATABASE_URL } from './test-env';

/** Applies migrations to the test database once before the integration tests run. */
export default function setup(): void {
  const url = TEST_DATABASE_URL;
  assertTestDatabase(url);
  const require = createRequire(__filename);
  const dbPackage = path.dirname(require.resolve('@hookline/db/package.json'));
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [dbPackage] });
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
