import { expect, test } from '@playwright/test';

test('loads the hashed production web bundle without runtime or asset failures', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith('http://127.0.0.1:') && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  const documentResponse = await page.goto('/');
  expect(documentResponse?.status()).toBe(200);
  await expect(page.getByRole('banner', { name: 'Toolbar' })).toContainText('KerfDesk');

  const scriptSources = await page
    .locator('script[src]')
    .evaluateAll((scripts) => scripts.map((script) => script.getAttribute('src') ?? ''));
  expect(scriptSources.some((source) => /^(?:\.\/|\/)assets\/.+\.js$/u.test(source))).toBe(true);
  expect(scriptSources.some((source) => source.includes('/src/'))).toBe(false);
  expect(failedAssets).toEqual([]);
  expect(pageErrors).toEqual([]);
});
