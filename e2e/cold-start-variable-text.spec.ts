import { applicationHeader } from './fixtures/workspace-ui';
import { expect, test } from './fixtures/kerfdesk-test';
import { waitForStartupSplash } from './fixtures/startup-splash';

// With no dependency cache the dev server transforms the whole module graph
// and optimizes dependencies on demand, which on a CI runner takes most of the
// default 60 s. This spec proves that start has no reload or 504, not its speed.
const COLD_START_TEST_TIMEOUT_MS = 180_000;
const COLD_START_SPLASH_TIMEOUT_MS = 120_000;

test.use({ startupSplash: 'manual' });

test('cold Vite start renders variable outline text without optimization reloads or 504s', async ({
  page,
}) => {
  test.setTimeout(COLD_START_TEST_TIMEOUT_MS);
  const startupFailures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) startupFailures.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => {
    if (/504|outdated optimize dep|dependency optimization/i.test(message.text())) {
      startupFailures.push(message.text());
    }
  });

  await page.goto('/');
  await waitForStartupSplash(page, COLD_START_SPLASH_TIMEOUT_MS);
  await expect(applicationHeader(page)).toContainText('KerfDesk');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 150, y: 200 } });
  await page.getByRole('textbox', { name: 'Text content on canvas' }).fill('Cold-{serial}');
  await page.getByRole('checkbox', { name: 'Variable text' }).check();
  await page.getByRole('button', { name: 'Serial' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.getByRole('region', { name: 'Text formatting' })).not.toBeVisible();
  expect(startupFailures).toEqual([]);
});
