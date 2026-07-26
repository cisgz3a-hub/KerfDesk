import { expect, test } from './fixtures/kerfdesk-test';

test('status overflow does not add a layout-consuming scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });

  const metrics = await page.getByRole('contentinfo', { name: 'Status bar' }).evaluate((footer) => {
    if (!(footer instanceof HTMLElement)) throw new Error('Status bar must be an HTML element');
    const style = getComputedStyle(footer);
    const borderHeight =
      Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    return {
      clientWidth: footer.clientWidth,
      scrollWidth: footer.scrollWidth,
      scrollbarHeight: footer.offsetHeight - footer.clientHeight - borderHeight,
    };
  });

  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.scrollbarHeight).toBe(0);
});
