import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { effectiveOperationForObject } from '../src/core/effective-output';
import { primaryOperationForObject, type Project, type RasterImage } from '../src/core/scene';
import { expect, test, type KerfDeskFixture } from './fixtures/kerfdesk-test';
import { saveProjectAs } from './fixtures/project-save';
import { toolbarCommand } from './fixtures/workspace-ui';

const portrait = readFileSync(
  fileURLToPath(new URL('../src/__fixtures__/perceptual/assets/astronaut.png', import.meta.url)),
).toString('base64');

test.use({ viewport: { width: 1440, height: 1000 } });

// ADR-670: generate a wedge from the photo's settings, record the burn, apply.
test('tone calibration burns a wedge with the photo settings, records it and lightens the photo', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await importPortrait(page, kerfdesk);

  // 1. From Photo engraving, calibrate with its unapplied Stucki draft.
  await (await toolbarCommand(page, 'Photo engraving...')).click();
  const photo = page.getByRole('dialog', { name: 'Photo engraving', exact: true });
  await photo
    .getByRole('radiogroup', { name: 'Photo processing' })
    .getByRole('radio', { name: 'Stucki', exact: true })
    .check();
  await expect(photo.getByRole('combobox', { name: 'Tone calibration' })).toHaveValue('none');
  await photo.getByRole('button', { name: 'Calibrate a material…' }).click();
  const tone = page.getByRole('dialog', { name: 'Tone Calibration', exact: true });
  await expect(tone).toContainText('Settings from portrait.png');
  await expect(tone.getByRole('combobox', { name: 'Wedge photo processing' })).toHaveValue(
    'stucki',
  );
  await tone.getByRole('button', { name: 'Generate wedge', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Save changes?', exact: true })
    .getByRole('button', { name: "Don't Save", exact: true })
    .click();
  await expect(tone).toBeHidden();
  const wedge = await savedProject(page, kerfdesk);
  const wedgeImage = rasters(wedge)[0];
  expect(rasters(wedge)).toHaveLength(1);
  expect(wedgeImage?.source).toBe('tone-calibration-wedge');
  const wedgeOperation = wedge.scene.layers.find((layer) => layer.mode === 'image');
  expect(wedgeOperation).toMatchObject({ ditherAlgorithm: 'stucki', passThrough: false });
  expect(wedgeOperation).not.toHaveProperty('photoToneCurve');
  expect(wedge.scene.objects.filter((object) => object.kind === 'imported-svg')).toHaveLength(11);
  await page.screenshot({ path: testInfo.outputPath('tone-wedge.png') });

  // 2. Record the burn: every midtone looked 25 points darker than asked.
  await toolsMenuCommand(page, 'Tone Calibration...');
  await tone.getByRole('tab', { name: '2. Record the result' }).click();
  await expect(tone).toContainText('Wedge of 11 patches burned with Stucki');
  for (const asked of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
    await tone
      .getByRole('slider', { name: `Patch ${asked} looks like` })
      .fill(String(Math.min(100, asked + 25)));
  }
  await tone.getByRole('textbox', { name: 'Calibrated material' }).fill('Birch ply');
  await page.screenshot({ path: testInfo.outputPath('tone-record.png') });
  await tone.getByRole('button', { name: 'Save calibration', exact: true }).click();
  await expect(tone).toBeHidden();

  // 3. Apply it to a photo: the preview loses dots, and the photo keeps the curve.
  await importPortrait(page, kerfdesk);
  await (await toolbarCommand(page, 'Photo engraving...')).click();
  await photo
    .getByRole('radiogroup', { name: 'Photo processing' })
    .getByRole('radio', { name: 'Stucki', exact: true })
    .check();
  const preview = photo.getByLabel('Photo engraving preview', { exact: true });
  await expect(preview).toBeVisible({ timeout: 60_000 });
  const uncalibrated = await settledMean(preview);
  const choice = photo.getByRole('combobox', { name: 'Tone calibration' });
  const label = await choice.locator('option', { hasText: 'Birch ply' }).textContent();
  expect(label).toContain('Birch ply · Stucki');
  await choice.selectOption({ label: label ?? '' });
  await expect(photo).not.toContainText('measured with a different');
  await expect
    .poll(() => meanLightness(preview), { timeout: 60_000 })
    .toBeGreaterThan(uncalibrated + 10);
  await page.screenshot({ path: testInfo.outputPath('tone-calibrated-photo.png') });
  await photo.getByRole('button', { name: 'Apply photo settings' }).click();
  await expect(photo).toBeHidden();

  const applied = await savedProject(page, kerfdesk);
  const image = rasters(applied).find((raster) => raster.source === 'portrait.png');
  if (image === undefined) throw new Error('Missing calibrated photo');
  const operation = primaryOperationForObject(image, applied.scene.layers);
  if (operation === null) throw new Error('Missing photo operation');
  expect(operation.id).not.toBe(wedgeOperation?.id);
  expect(operation).not.toHaveProperty('photoToneCurve');
  const effective = effectiveOperationForObject(operation, image);
  expect(effective.ditherAlgorithm).toBe('stucki');
  expect(effective.photoToneCurve?.label).toBe(label);
  expect(effective.photoToneCurve?.points[0]).toEqual({ input: 0, output: 0 });
  expect(effective.photoToneCurve?.points.at(-1)).toEqual({ input: 255, output: 255 });
  expect((await kerfdesk.events()).some((event) => event.kind.startsWith('serial-'))).toBe(false);
  expect(errors).toEqual([]);
});

async function importPortrait(page: Page, fixture: KerfDeskFixture): Promise<void> {
  await fixture.setOpenFiles([{ name: 'portrait.png', base64: portrait, mimeType: 'image/png' }]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(await toolbarCommand(page, 'Photo engraving...')).toBeEnabled({ timeout: 60_000 });
}

async function toolsMenuCommand(page: Page, name: string): Promise<void> {
  const menu = page.locator('details[data-menu-family="tools"]');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await menu
    .locator('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .click({ timeout: 15_000 });
}

function rasters(project: Project): RasterImage[] {
  return project.scene.objects.filter(
    (object): object is RasterImage => object.kind === 'raster-image',
  );
}

async function savedProject(page: Page, fixture: KerfDeskFixture): Promise<Project> {
  await saveProjectAs(page, fixture);
  const files = Object.values(await fixture.savedFiles());
  const saved = files.reverse().find((text) => text.includes('raster-image'));
  if (saved === undefined) throw new Error('Missing saved project');
  return JSON.parse(saved) as Project;
}

/** Mean preview lightness once two reads agree (the worker has finished). */
async function settledMean(preview: Locator): Promise<number> {
  let previous = -1;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await meanLightness(preview);
    if (current === previous) return current;
    previous = current;
    await preview.page().waitForTimeout(500);
  }
  return previous;
}

async function meanLightness(preview: Locator): Promise<number> {
  return preview.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (context === null) return 0;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let index = 0; index < data.length; index += 4) sum += data[index] ?? 0;
    return sum / (data.length / 4);
  });
}
