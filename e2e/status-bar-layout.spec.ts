import { expect, test, type Page } from './fixtures/kerfdesk-test';

test('status overflow does not add a layout-consuming scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });

  const metrics = await page.getByRole('contentinfo', { name: 'Status bar' }).evaluate((footer) => {
    if (!(footer instanceof HTMLElement)) throw new Error('Status bar must be an HTML element');
    const telemetry = footer.querySelector('.lf-status-bar__telemetry');
    if (!(telemetry instanceof HTMLElement)) throw new Error('Telemetry must be an HTML element');
    const style = getComputedStyle(telemetry);
    const borderHeight =
      Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    return {
      clientWidth: telemetry.clientWidth,
      scrollWidth: telemetry.scrollWidth,
      scrollbarHeight: telemetry.offsetHeight - telemetry.clientHeight - borderHeight,
    };
  });

  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.scrollbarHeight).toBe(0);
});

test('keeps the ready Update action inside every compact viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });
  await stagePwaUpdate(page);

  for (const width of [640, 390, 320]) {
    await page.setViewportSize({ width, height: 450 });
    const button = page.getByRole('button', { name: 'Apply app update' });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? width) + (bounds?.width ?? 1)).toBeLessThanOrEqual(width);
  }
});

test.describe('desktop preview update action', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36 Electron/42.5.1',
  });

  test('keeps the longer Download update action inside every compact viewport', async ({
    page,
  }) => {
    await page.route('**/api/desktop-preview-update', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ kind: 'available', version: '1.2.3-preview.5' }),
      }),
    );
    await page.goto('/');
    await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });

    const link = page.getByRole('link', { name: 'Download KerfDesk 1.2.3-preview.5' });
    await expect(link).toBeVisible();
    for (const width of [640, 390, 320]) {
      await page.setViewportSize({ width, height: 450 });
      const bounds = await link.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? width) + (bounds?.width ?? 1)).toBeLessThanOrEqual(width);
      const footerOverflow = await page
        .getByRole('contentinfo', { name: 'Status bar' })
        .evaluate((footer) => footer.scrollWidth - footer.clientWidth);
      expect(footerOverflow).toBeLessThanOrEqual(0);
    }
  });
});

async function stagePwaUpdate(page: Page): Promise<void> {
  await page.evaluate(async (modulePath) => {
    const loaded = (await import(/* @vite-ignore */ modulePath)) as {
      usePwaUpdateStore: {
        setState(state: { availability: { kind: 'ready'; applyUpdate(): Promise<void> } }): void;
      };
    };
    loaded.usePwaUpdateStore.setState({
      availability: { kind: 'ready', applyUpdate: () => Promise.resolve() },
    });
  }, '/src/ui/state/pwa-update-store.ts');
}
