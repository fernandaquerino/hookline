import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './test/test-env.js';

// Integration tests share one Postgres database, so files run one at a time.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: { DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL },
  },
});
