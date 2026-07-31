import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner', { name: 'Toolbar' })).toContainText('KerfDesk');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });
});

test('keeps complete Library artwork previews contained at desktop and narrow widths', async ({
  page,
}) => {
  for (const viewport of [
    { width: 1180, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Open design library', exact: true }).click();
    await page.getByRole('button', { name: 'Icons & Symbols 46', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Acorn preview', exact: true })).toBeVisible();

    const card = page
      .locator('[data-library-card]')
      .filter({ has: page.getByRole('button', { name: 'View details for Acorn', exact: true }) });
    await expectPreviewContained(card.locator('.lf-library-preview'));
    await expectPreviewContained(page.locator('.lf-library-preview--detail'));
    await expectNoPageOverflow(page);

    await page.getByRole('button', { name: 'Close Design Library', exact: true }).click();
  }
});

async function expectPreviewContained(preview: Locator): Promise<void> {
  const metrics = await preview.evaluate((element) => {
    const image = element.querySelector('img');
    if (!(image instanceof HTMLImageElement)) return null;
    const previewRect = element.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const imageStyle = getComputedStyle(image);
    return {
      preview: {
        left: previewRect.left,
        top: previewRect.top,
        right: previewRect.right,
        bottom: previewRect.bottom,
        width: previewRect.width,
        height: previewRect.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      },
      image: {
        left: imageRect.left,
        top: imageRect.top,
        right: imageRect.right,
        bottom: imageRect.bottom,
      },
      objectFit: imageStyle.objectFit,
      objectPosition: imageStyle.objectPosition,
    };
  });
  expect(metrics).not.toBeNull();
  if (metrics === null) return;
  expect(metrics.objectFit).toBe('contain');
  expect(metrics.objectPosition).toBe('50% 50%');
  expect(metrics.preview.width / metrics.preview.height).toBeCloseTo(4 / 3, 1);
  expect(metrics.image.left).toBeGreaterThanOrEqual(metrics.preview.left);
  expect(metrics.image.top).toBeGreaterThanOrEqual(metrics.preview.top);
  expect(metrics.image.right).toBeLessThanOrEqual(metrics.preview.right);
  expect(metrics.image.bottom).toBeLessThanOrEqual(metrics.preview.bottom);
  expect(metrics.preview.scrollWidth).toBeLessThanOrEqual(metrics.preview.clientWidth);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}
