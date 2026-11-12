import { defineConfig, devices } from '@playwright/test';
import { E2E, serverEnv } from './env';

const env = { ...process.env, ...serverEnv() } as Record<string, string>;

/**
 * Boots the whole stack: stub destination, API, dispatcher and a production build of the
 * dashboard. Services must be built first (`pnpm build`); the dashboard is rebuilt here because
 * Next.js bakes the /api rewrite target (API_URL) into the build.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${E2E.webPort}`,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node stub-destination.mjs',
      url: `http://127.0.0.1:${E2E.stubPort}/health`,
      env,
      reuseExistingServer: false,
    },
    {
      command: 'node start-backend.mjs',
      url: `http://localhost:${E2E.apiPort}/health`,
      env,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${E2E.webPort}`,
      cwd: '../apps/web',
      url: `http://localhost:${E2E.webPort}/login`,
      // Separate build directory so the E2E build does not replace the developer's .next.
      env: { ...env, NODE_ENV: 'production', NEXT_DIST_DIR: '.next-e2e' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
