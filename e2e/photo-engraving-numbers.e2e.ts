import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { effectiveOperationForObject } from '../src/core/effective-output';
import { primaryOperationForObject, type Project, type RasterImage } from '../src/core/scene';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { saveProjectAs } from './fixtures/project-save';
import { toolbarCommand } from './fixtures/workspace-ui';

const portrait = readFileSync(
  fileURLToPath(new URL('../src/__fixtures__/perceptual/assets/astronaut.png', import.meta.url)),
).toString('base64');

test.use({ viewport: { width: 1440, height: 1000 } });

test('photo form accepts fractional resolution and tone values and persists them', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await importPortrait(page, kerfdesk);
  await (await toolbarCommand(page, 'Photo engraving...')).click();
  const dialog = page.getByRole('dialog', { name: 'Photo engraving', exact: true });
  for (const [name, entered, clamped] of [
    ['Photo brightness', '1000', '100'],
    ['Photo midtones (gamma)', '0', '0.1'],
    ['Photo engraving DPI', '10', '127'],
  ] as const) {
    const field = dialog.getByRole('spinbutton', { name, exact: true });
    await field.fill(entered);
    await field.blur();
    await expect(field).toHaveValue(clamped);
  }
  const fields = [
    ['Photo brightness', '1.25'],
    ['Photo contrast', '-2.75'],
    ['Photo midtones (gamma)', '1.23'],
    ['Photo engraving DPI', '203.2'],
  ] as const;
  for (const [name, value] of fields) {
    const field = dialog.getByRole('spinbutton', { name, exact: true });
    await field.fill(value);
    await field.blur();
    expect
      .soft(await field.evaluate((node: HTMLInputElement) => node.checkValidity()), name)
      .toBe(true);
  }
  await page.setViewportSize({ width: 800, height: 600 });
  expect(
    await dialog.locator('form').evaluate((form) => form.scrollWidth <= form.clientWidth),
  ).toBe(true);
  const apply = dialog.getByRole('button', { name: 'Apply photo settings', exact: true });
  await apply.scrollIntoViewIfNeeded();
  await expect(apply).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('photo-fractional-settings-narrow.png') });
  await dialog.getByRole('button', { name: 'Apply photo settings', exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = await savePhotoProject(page, kerfdesk);
  const image = photoIn(saved);
  expect(image).toMatchObject({ brightness: 1.25, contrast: -2.75, gamma: 1.23 });
  const operation = primaryOperationForObject(image, saved.scene.layers);
  if (operation === null) throw new Error('Missing photo operation');
  expect(effectiveOperationForObject(operation, image).linesPerMm).toBe(8);
});

test('stored fractional tones and low density allow unrelated photo edits', async ({
  page,
  kerfdesk,
}) => {
  await importPortrait(page, kerfdesk);
  const baseline = await savePhotoProject(page, kerfdesk);
  const original = photoIn(baseline);
  const stored: Project = {
    ...baseline,
    scene: {
      ...baseline.scene,
      objects: baseline.scene.objects.map((object) =>
        object === original
          ? { ...original, brightness: 0.125, contrast: -2.625, gamma: 1.2345 }
          : object,
      ),
      layers: baseline.scene.layers.map((layer) => ({ ...layer, linesPerMm: 2 })),
    },
  };
  await kerfdesk.setOpenFiles([{ name: 'stored-photo.lf2', text: JSON.stringify(stored) }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/stored-photo\.lf2/);
  await page.keyboard.press('Control+a');
  await (await toolbarCommand(page, 'Photo engraving...')).click();
  const dialog = page.getByRole('dialog', { name: 'Photo engraving', exact: true });
  await expect(dialog.getByRole('spinbutton', { name: 'Photo engraving DPI' })).toHaveValue('50.8');
  await dialog.getByRole('combobox', { name: 'Photo processing' }).selectOption('stucki');
  expect(
    await dialog.locator('form').evaluate((form: HTMLFormElement) => form.checkValidity()),
  ).toBe(true);
  await dialog.getByRole('button', { name: 'Apply photo settings', exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = await savePhotoProject(page, kerfdesk);
  const image = photoIn(saved);
  expect(image).toMatchObject({ brightness: 0.125, contrast: -2.625, gamma: 1.2345 });
  const operation = primaryOperationForObject(image, saved.scene.layers);
  if (operation === null) throw new Error('Missing photo operation');
  expect(effectiveOperationForObject(operation, image)).toMatchObject({
    linesPerMm: 2,
    ditherAlgorithm: 'stucki',
  });
});

async function importPortrait(page: Page, fixture: KerfDeskFixture): Promise<void> {
  await page.goto('/');
  await fixture.setOpenFiles([{ name: 'portrait.png', base64: portrait, mimeType: 'image/png' }]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(await toolbarCommand(page, 'Photo engraving...')).toBeEnabled({ timeout: 30_000 });
}

async function savePhotoProject(page: Page, fixture: KerfDeskFixture): Promise<Project> {
  await saveProjectAs(page, fixture);
  const text = Object.values(await fixture.savedFiles())
    .reverse()
    .find((value) => value.includes('raster-image'));
  if (text === undefined) throw new Error('Missing saved photo project');
  return JSON.parse(text) as Project;
}

function photoIn(project: Project): RasterImage {
  const image = project.scene.objects.find((object) => object.kind === 'raster-image');
  if (image?.kind !== 'raster-image') throw new Error('Missing imported photo');
  return image;
}
