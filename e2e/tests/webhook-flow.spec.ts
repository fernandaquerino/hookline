import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { E2E } from '../env';

const run = promisify(execFile);

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Password').fill(E2E.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Endpoints' })).toBeVisible();
}

test('create an endpoint, send a webhook with curl, see it live and watch the retry succeed', async ({
  page,
}) => {
  await signIn(page);

  // Create an endpoint.
  await page.getByRole('button', { name: 'New endpoint' }).click();
  await page.getByLabel('Name').fill('E2E orders');
  await page.getByRole('button', { name: 'Create endpoint' }).click();
  await expect(page.getByRole('heading', { name: 'E2E orders' })).toBeVisible();
  await expect(page.getByTestId('live-status')).toHaveText('Live');
  await expect(page.getByText('Waiting for the first request')).toBeVisible();

  // Point it at the stub destination, which fails every first attempt with 503.
  const destination = `http://127.0.0.1:${E2E.stubPort}/webhooks`;
  await page.getByLabel('Destination URL').fill(destination);
  await page.getByRole('button', { name: 'Add destination' }).click();
  await expect(page.getByTestId('destination')).toContainText(destination);

  // Send a webhook with curl, exactly as a developer would.
  const ingestUrl = (await page.getByTestId('ingest-url').textContent())?.trim() ?? '';
  expect(ingestUrl).toMatch(new RegExp(`^http://localhost:${E2E.apiPort}/in/[A-Za-z0-9_-]{12}$`));
  const { stdout } = await run('curl', [
    '-sS',
    '-X',
    'POST',
    ingestUrl,
    '-H',
    'Content-Type: application/json',
    '-H',
    'Authorization: Bearer e2e-secret-token',
    '-d',
    '{"order":"e2e-1001","status":"created"}',
    '-w',
    '\n%{http_code}',
  ]);
  const [body, status] = stdout.trim().split('\n');
  expect(status).toBe('202');
  expect(JSON.parse(body ?? '{}')).toMatchObject({
    signatureStatus: 'not_configured',
    deliveries: 1,
  });

  // It shows up in the live tail without reloading the page...
  const row = page.getByTestId('tail-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('POST');
  await expect(row).toContainText('application/json');
  // ...and the delivery goes from a failed first attempt to success.
  await expect(row.locator('[data-status="SUCCEEDED"]')).toBeVisible();

  // The inspector shows both attempts, the redacted header and the pretty-printed body.
  await row.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Deliveries' })).toBeVisible();
  const attempts = page.getByTestId('attempt');
  await expect(attempts).toHaveCount(2);
  await expect(attempts.nth(0)).toContainText('HTTP 503');
  await expect(attempts.nth(1)).toContainText('HTTP 200');
  await expect(page.getByTestId('delivery').locator('[data-status="SUCCEEDED"]')).toBeVisible();
  await expect(page.getByRole('row', { name: /authorization/ })).toContainText('[redacted]');
  await expect(page.getByTestId('body')).toContainText('"order": "e2e-1001"');

  // The stub saw both attempts, with the Hookline headers, and never the bearer token.
  const received = (await (
    await fetch(`http://127.0.0.1:${E2E.stubPort}/received`)
  ).json()) as Array<{
    attempt: number;
    body: string;
  }>;
  expect(received.map((r) => r.attempt)).toEqual([1, 2]);
  expect(received[0]?.body).toBe('{"order":"e2e-1001","status":"created"}');
});

test('replaying a delivery from the inspector creates a new delivery', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'E2E orders' }).click();
  await page.getByTestId('tail-row').first().getByRole('link').click();
  await expect(page.getByTestId('delivery')).toHaveCount(1);

  await page.getByTestId('delivery').getByRole('button', { name: 'Replay' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replay delivery' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Replay' }).click();

  await expect(page.getByTestId('delivery')).toHaveCount(2);
  // The replay's first attempt hits the stub's 503, then its retry succeeds.
  await expect(
    page.getByTestId('delivery').nth(1).locator('[data-status="SUCCEEDED"]'),
  ).toBeVisible();
  await expect(page.getByTestId('delivery').nth(1)).toContainText('Replay');
});
