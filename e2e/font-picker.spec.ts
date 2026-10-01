import { expect, test } from './fixtures/kerfdesk-test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const height of [600, 768]) {
  test(`font browsing stays inside its menu in a 1024 × ${height} window`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height });
    await page.goto('/');
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page
      .getByLabel('KerfDesk workspace', { exact: true })
      .click({ position: { x: 180, y: 220 } });
    const text = page.getByRole('textbox', { name: 'Text content on canvas' });
    await text.fill('Font scrolling café');
    const trigger = page.getByRole('button', { name: 'Font', exact: true });
    await trigger.click();
    const chooser = page.getByRole('dialog', { name: 'Choose a font', exact: true });
    const list = chooser.getByRole('listbox', { name: 'Fonts', exact: true });
    const bounds = await chooser.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds === null) throw new Error('Font chooser missing');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    expect(await list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
    const panel = page.locator('.lf-canvas-text-scroll');
    const panelScroll = await panel.evaluate((element) => element.scrollTop);
    const last = list.getByRole('option').last();
    await last.scrollIntoViewIfNeeded();
    await last.hover();
    await page.mouse.wheel(0, 900);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await panel.evaluate((element) => element.scrollTop)).toBe(panelScroll);
    await expect(trigger).toBeVisible();
    const browsingScroll = await list.evaluate((element) => element.scrollTop);
    await text.fill('Font scrolling café continued');
    await expect(page.getByRole('region', { name: 'Text formatting' })).toContainText(
      'Live preview',
    );
    expect(await list.evaluate((element) => element.scrollTop)).toBe(browsingScroll);
    const selected = await last.locator('button').getAttribute('data-font-key');
    if (selected === null) throw new Error('Font key missing');
    await last.locator('button').click();
    await expect(chooser).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(list.locator('[aria-selected="true"]')).toBeInViewport({ ratio: 1 });
    await expect(list.locator('[aria-selected="true"] button')).toHaveAttribute(
      'data-font-key',
      selected,
    );
    await chooser.getByRole('searchbox', { name: 'Search fonts' }).press('Escape');
    await expect(chooser).toHaveCount(0);
    await expect(text).toHaveValue('Font scrolling café continued');
    await expect(trigger).toBeFocused();
  });
}

test('a long imported filename fits the text panel and keeps its menu beside the font control', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 180, y: 220 } });
  await page.getByRole('textbox', { name: 'Text content on canvas' }).fill('Imported café');
  const name = 'A project font with a deliberately long filename for checking picker overflow.ttf';
  await page.getByLabel('Import font file', { exact: true }).setInputFiles({
    name,
    mimeType: 'font/ttf',
    buffer: readFileSync(resolve('src/ui/text/fonts/Tinos-Regular.ttf')),
  });
  const trigger = page.getByRole('button', { name: 'Font', exact: true });
  await expect(trigger).toContainText(name);
  const panel = page.getByRole('region', { name: 'Text formatting' });
  const panelBounds = await panel.boundingBox();
  const triggerBounds = await trigger.boundingBox();
  if (panelBounds === null || triggerBounds === null) throw new Error('Text controls missing');
  expect(triggerBounds.x).toBeGreaterThanOrEqual(panelBounds.x);
  expect(triggerBounds.x + triggerBounds.width).toBeLessThanOrEqual(
    panelBounds.x + panelBounds.width,
  );
  expect(
    await page
      .locator('.lf-canvas-text-scroll')
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBe(0);
  await trigger.click();
  const chooser = page.getByRole('dialog', { name: 'Choose a font', exact: true });
  const chooserBounds = await chooser.boundingBox();
  if (chooserBounds === null) throw new Error('Font chooser missing');
  expect(chooserBounds.x).toBeCloseTo(triggerBounds.x);
  await expect(chooser.getByRole('option', { selected: true })).toBeInViewport({ ratio: 1 });
  await chooser.getByRole('searchbox', { name: 'Search fonts' }).press('Escape');
  await expect(page.getByRole('textbox', { name: 'Text content on canvas' })).toHaveValue(
    'Imported café',
  );
});
