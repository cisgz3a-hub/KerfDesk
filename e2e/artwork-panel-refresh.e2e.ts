import { expect, test } from './fixtures/kerfdesk-test';
import { createLayer } from '../src/core/scene';
import { captureMaterialRecipe } from '../src/core/material-library';

test('panel tasks stay separate and fit a narrow rail', async ({ page, kerfdesk }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/, { timeout: 30_000 });
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await expect(panel.getByRole('radiogroup', { name: /^Mode for/ })).toBeVisible();
  await expect(panel.getByLabel('Design hierarchy')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Objects', exact: true }).click();
  const organiser = page.getByRole('dialog', { name: 'Organise artwork' });
  await expect(organiser.getByRole('list', { name: 'Design object tree' })).toBeVisible();
  await expect(organiser.locator('[data-design-root-drop]')).toHaveCount(0);
  await organiser.screenshot({ path: testInfo.outputPath('objects.png') });
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: 'Objects', exact: true })).toBeFocused();
  const tabs = panel.getByRole('tablist', { name: 'Artwork panel view', exact: true });
  await tabs.getByRole('tab', { name: 'Materials', exact: true }).click();
  await kerfdesk.setOpenFiles([
    {
      name: 'panel-library.lfml.json',
      text: JSON.stringify({
        format: 'laserforge-material-library',
        librarySchemaVersion: 3,
        libraryId: 'panel-library',
        name: 'Workshop presets',
        entries: [
          {
            id: 'birch',
            materialName: 'Birch plywood',
            thicknessMm: 3,
            description: 'Test engraving preset',
            revision: '1',
            recipe: captureMaterialRecipe({
              ...createLayer({ id: 'preset', color: '#000000', mode: 'fill' }),
              power: 25,
              speed: 2400,
            }),
          },
        ],
      }),
    },
  ]);
  await panel.getByRole('button', { name: 'Open saved libraries' }).click();
  const libraries = page.getByRole('dialog', { name: 'Saved Libraries', exact: true });
  await libraries.getByRole('button', { name: 'Import library', exact: true }).click();
  await expect(page.getByText('Loaded material library: Workshop presets')).toBeVisible();
  await expect(libraries).toBeHidden();
  for (const width of [280, 360]) {
    await panel.evaluate((element, size) => {
      Object.assign((element as HTMLElement).style, {
        width: `${size}px`,
        minWidth: `${size}px`,
        maxWidth: `${size}px`,
        flex: `0 0 ${size}px`,
      });
    }, width);
    for (const name of ['Settings', 'Run order', 'Materials']) {
      await tabs.getByRole('tab', { name, exact: true }).click();
      if (
        name === 'Materials' &&
        (await panel.getByRole('button', { name: 'Create new material library' }).isVisible())
      ) {
        await panel.getByRole('button', { name: 'Create new material library' }).click();
      }
      if (name === 'Run order') {
        await expect(panel.getByRole('article').first()).toBeVisible();
        await expect(panel.getByRole('searchbox')).toBeHidden();
        await panel.locator('summary').filter({ hasText: 'Find or jump to a run' }).click();
        await expect(panel.getByRole('searchbox')).toBeVisible();
        await panel.getByRole('checkbox', { name: 'Show cutting settings' }).check();
        await panel.getByRole('checkbox', { name: 'Show cutting settings' }).uncheck();
        await panel.locator('summary').filter({ hasText: 'Find or jump to a run' }).click();
      }
      const content = panel.getByRole('tabpanel').first();
      expect(
        await content.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      await panel.screenshot({
        path: testInfo.outputPath(`${name.toLowerCase().replace(' ', '-')}-${width}.png`),
      });
    }
  }
  await panel.getByRole('button', { name: 'Apply selected material preset to layer' }).click();
  await tabs.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(panel.getByRole('spinbutton', { name: /^Power for/ })).toHaveValue('25');
  await expect(panel.getByRole('spinbutton', { name: /^Speed for/ })).toHaveValue('2400');
});
