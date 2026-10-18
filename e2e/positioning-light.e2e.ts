import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`centre light setup and off remain usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/e2e/fixtures/positioning-light.html');
    const centre = page.getByRole('button', { name: 'Artwork centre & LED', exact: true });
    await expect(centre).toBeDisabled();
    await page.getByRole('button', { name: 'Set up LED', exact: true }).click();
    const configure = page.getByLabel('Configure a separate LED / crosshair');
    await expect(configure).toBeVisible();
    await configure.check();
    await page.getByLabel('Light on command', { exact: true }).fill('M3 S100');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Positioning light on command' }),
    ).toBeVisible();
    await page.getByLabel('Light on command', { exact: true }).fill('M64 P0');
    await page.getByLabel('Light off command', { exact: true }).fill('M65 P0');
    await page.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
    await page.getByRole('button', { name: 'Load configured fixture', exact: true }).click();
    await expect(centre).toBeEnabled();
    await centre.click();
    await expect(page.locator('#result')).toHaveText('Simulated centre 8, 8');
    const on = page.getByRole('button', { name: 'LED on', exact: true });
    await expect(on).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Select two artworks', exact: true }).click();
    const chooser = page.getByRole('combobox', { name: 'Artwork to centre' });
    await expect(chooser).toBeVisible();
    await expect(centre).toBeDisabled();
    await chooser.selectOption({ label: '2. Badge · 20 × 10 mm' });
    await expect(page.locator('#centre-count')).toHaveText('1');
    await centre.click();
    await expect(page.locator('#result')).toHaveText('Simulated centre 88, 68');
    await expect(page.locator('#centre-count')).toHaveText('2');
    await page.getByRole('button', { name: 'Deselect fixture', exact: true }).click();
    await expect(centre).toBeDisabled();
    const off = page.getByRole('button', { name: 'LED off', exact: true });
    await expect(off).toBeEnabled();
    await off.click();
    await expect(page.locator('#result')).toHaveText('Simulated LED off');
    await expect(on).toHaveAttribute('aria-pressed', 'false');
    await on.click();
    await expect(page.locator('#result')).toHaveText('Simulated LED on');
    await expect(on).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#centre-count')).toHaveText('2');
    await off.click();
    const rail = await page.getByRole('complementary', { name: 'Machine controls' }).boundingBox();
    const button = await off.boundingBox();
    if (rail === null || button === null) throw new Error('Machine controls are not rendered.');
    expect(button.x + button.width).toBeLessThanOrEqual(rail.x + rail.width);
    await info.attach('positioning-light-controls', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
