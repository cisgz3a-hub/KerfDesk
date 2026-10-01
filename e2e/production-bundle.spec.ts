import { applicationHeader } from './fixtures/workspace-ui';
import { expect, test } from '@playwright/test';

test('routes mobile browsers without downloading workspace algorithms', async ({
  browser,
  baseURL,
}) => {
  for (const [width, height, userAgent] of [
    [390, 844, 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Safari/604.1'],
    [844, 390, 'Mozilla/5.0 (Linux; Android 15) Chrome/144 Mobile Safari/537.36'],
    [1024, 1366, 'Mozilla/5.0 (iPad) AppleWebKit/605.1.15 Safari/604.1'],
  ] as const) {
    const context = await browser.newContext({
      ...(baseURL === undefined ? {} : { baseURL }),
      viewport: { width, height },
      userAgent,
      isMobile: true,
      hasTouch: true,
    });
    try {
      await context.route('https://license.kerfdesk.com/**', (route) =>
        route.fulfill({ contentType: 'application/json', body: '{"enabled":false}' }),
      );
      const page = await context.newPage();
      const modules: string[] = [];
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith('/assets/') && path.endsWith('.js')) modules.push(path);
      });
      await page.goto('/');
      await expect(page).toHaveURL(/\/buy(?:\.html)?$/);
      await expect(
        page.getByRole('status').filter({ hasText: 'Pro purchases are not open yet' }),
      ).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(0);
      expect(modules.some((path) => /\/index-[^/]+\.js$/u.test(path))).toBe(true);
      expect(
        modules.every((path) => /^\/assets\/(?:index|preload-helper)-[^/]+\.js$/u.test(path)),
      ).toBe(true);
    } finally {
      await context.close();
    }
  }
});

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
  await page.route('https://dl.kerfdesk.com/**', (route) =>
    route.fulfill({ status: 404, body: 'No test release' }),
  );
  const documentResponse = await page.goto('/');
  expect(documentResponse?.status()).toBe(200);
  await expect(applicationHeader(page)).toContainText('KerfDesk');
  const welcome = page.getByRole('dialog', { name: 'Choose your KerfDesk workspace' });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Continue with Free', exact: true }).click();
  await expect(welcome).toHaveCount(0);
  // The shipped browser is Free even though the development renderer regression
  // harness exercises desktop Pro tools. This assertion uses only visible UI.
  await page.getByRole('button', { name: 'Open Design Studio', exact: true }).click();
  const proDialog = page.getByRole('dialog', { name: 'Design Studio is a Pro tool' });
  await expect(proDialog).toBeVisible();
  await expect(proDialog.getByRole('link', { name: 'Get KerfDesk Pro' })).toHaveAttribute(
    'href',
    'https://kerfdesk.com/download.html',
  );
  await expect(page.getByRole('dialog', { name: 'Design Studio', exact: true })).toHaveCount(0);
  await proDialog.getByRole('button', { name: 'Not now' }).click();

  const scriptSources = await page
    .locator('script[src]')
    .evaluateAll((scripts) => scripts.map((script) => script.getAttribute('src') ?? ''));
  expect(scriptSources.some((source) => /^(?:\.\/|\/)assets\/.+\.js$/u.test(source))).toBe(true);
  expect(scriptSources.some((source) => source.includes('/src/'))).toBe(false);

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByLabel('KerfDesk workspace', { exact: true }).click({
    position: { x: 180, y: 220 },
  });
  const input = page.getByRole('textbox', { name: 'Text content on canvas' });
  await input.fill('Emma & James');
  await page.getByTitle('Open the font picker and choose the text typeface.').click();
  // The production bundle loads the shared menu stylesheet after the text
  // component stylesheet. Font rows must keep their own layout in that order.
  const fontRows = page
    .getByRole('dialog', { name: 'Choose a font', exact: true })
    .locator('.lf-font-picker-option');
  await expect(fontRows.first()).toHaveCSS('align-items', 'stretch');
  await expect(fontRows.first()).toHaveCSS('gap', '3px');
  await expect(fontRows.first()).toHaveCSS('padding', '7px 9px');
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
