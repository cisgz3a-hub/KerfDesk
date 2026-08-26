import { expect, test } from './fixtures/kerfdesk-test';

test('cold Vite start renders variable outline text without optimization reloads or 504s', async ({
  page,
}) => {
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
  await expect(page.getByRole('banner', { name: 'Toolbar' })).toContainText('KerfDesk');
  await page.getByRole('button', { name: 'Text...' }).click();
  await page.getByRole('textbox', { name: 'Text content' }).fill('Cold-{serial}');
  await page.getByRole('checkbox', { name: 'Variable text' }).check();
  await page.getByRole('button', { name: 'Serial' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Add or edit text' })).not.toBeVisible();
  expect(startupFailures).toEqual([]);
});
