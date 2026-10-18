import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`centre light setup and off remain usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/e2e/fixtures/positioning-light.html');
    const centre = page.getByRole('button', { name: 'Centre & LED', exact: true });
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
    const offCommand = page.getByLabel('Light off command', { exact: true });
    await offCommand.fill('M064 P00');
    await expect(page.getByRole('alert')).toContainText('on and off commands must be different');
    await offCommand.fill('M65 P1');
    await expect(page.getByRole('alert')).toContainText('same output');
    await offCommand.fill('M65 P0');
    await expect(page.getByRole('alert')).toBeHidden();
    await page.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
    await page.getByRole('button', { name: 'Load configured fixture', exact: true }).click();
    await expect(centre).toBeEnabled();
    await centre.click();
    await expect(page.locator('#result')).toHaveText('Simulated centre 8, 8');
    await page.getByRole('button', { name: 'Deselect fixture', exact: true }).click();
    await expect(centre).toBeDisabled();
    const off = page.getByRole('button', { name: 'LED off', exact: true });
    await expect(off).toBeEnabled();
    await off.click();
    await expect(page.locator('#result')).toHaveText('Simulated LED off');
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
