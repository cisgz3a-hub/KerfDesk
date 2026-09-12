import { expect, test } from '@playwright/test';

test('loads the hashed production bundle and edits script through its outline worker', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const failedAssets: string[] = [];
  const workerUrls: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  page.on('response', (response) => {
    if (response.url().startsWith('http://127.0.0.1:') && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.setViewportSize({ width: 1500, height: 950 });
  const documentResponse = await page.goto('/');
  expect(documentResponse?.status()).toBe(200);
  await expect(page.getByRole('banner', { name: 'Toolbar' })).toContainText('KerfDesk');

  const scriptSources = await page
    .locator('script[src]')
    .evaluateAll((scripts) => scripts.map((script) => script.getAttribute('src') ?? ''));
  expect(scriptSources.some((source) => /^(?:\.\/|\/)assets\/.+\.js$/u.test(source))).toBe(true);
  expect(scriptSources.some((source) => source.includes('/src/'))).toBe(false);

  await page.getByRole('button', { name: 'Text...', exact: true }).click();
  await page.getByLabel('KerfDesk workspace', { exact: true }).click({
    position: { x: 180, y: 220 },
  });
  const input = page.getByRole('textbox', { name: 'Text content on canvas' });
  await input.fill('Emma & James');
  await page.getByTitle('Open the font picker and choose the text typeface.').click();
  await page.getByRole('button', { name: /^Great Vibes/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Weld overlapping letters' })).toBeChecked();
  const formatting = page.getByRole('region', { name: 'Text formatting' });
  await expect(formatting).toContainText('Live preview');
  await expect(formatting.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(workerUrls.some((url) => /\/assets\/text-weld-worker-[^/]+\.js$/u.test(url))).toBe(true);
  expect(failedAssets).toEqual([]);
  expect(pageErrors).toEqual([]);
});
