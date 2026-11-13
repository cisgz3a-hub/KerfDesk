import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import {
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
} from '../src/core/effective-output';
import { primaryOperationForObject, type Project, type RasterImage } from '../src/core/scene';
import { expect, test, type KerfDeskFixture } from './fixtures/kerfdesk-test';
import { saveProjectAs } from './fixtures/project-save';
import { toolbarCommand } from './fixtures/workspace-ui';

const portrait = readFileSync(
  fileURLToPath(new URL('../src/__fixtures__/perceptual/assets/astronaut.png', import.meta.url)),
).toString('base64');

test.use({ viewport: { width: 1440, height: 1000 } });

// ADR-711: make a card from the photo, pick the best square, burn the photo with it.
test('a photo test card burns pieces of the photo and its picked square sets power and speed', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await importPortrait(page, kerfdesk);

  // 1. From Photo engraving, make a card with its unapplied slate recipe.
  await (await toolbarCommand(page, 'Photo engraving...')).click();
  const photo = page.getByRole('dialog', { name: 'Photo engraving', exact: true });
  await photo.getByRole('combobox', { name: 'Material recipe' }).selectOption('slate');
  const tested = photo.getByRole('combobox', { name: 'Tested power and speed' });
  await expect(tested).toHaveValue('keep');
  await photo.getByRole('button', { name: 'Burn a test card…' }).click();
  await expect(photo).toBeHidden();
  const card = page.getByRole('dialog', { name: 'Photo Test Card', exact: true });
  // The dialog loads on demand; a cold server takes a while to serve it.
  await expect(card).toContainText('Squares cut from portrait.png', { timeout: 60_000 });
  // The window's recipe went onto the photo first, so Undo after the card
  // returns to a photo that is ready to burn.
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  const prepared = await savedProject(page, kerfdesk);
  const preparedPhoto = rasters(prepared)[0];
  if (preparedPhoto === undefined) throw new Error('Missing prepared photo');
  const preparedOperation = primaryOperationForObject(preparedPhoto, prepared.scene.layers);
  if (preparedOperation === null) throw new Error('Missing prepared operation');
  expect(effectiveOperationForObject(preparedOperation, preparedPhoto)).toMatchObject({
    ditherAlgorithm: 'blue-noise',
    negativeImage: true,
  });
  // Tools → Photo Test Card takes the selected photo as it now burns.
  await toolsMenuCommand(page, 'Photo Test Card...');
  await expect(card).toContainText('Squares cut from portrait.png');
  await expect(card).toContainText('Blue Noise');
  await expect(card).toContainText('light marks');
  await expect(card.getByRole('button', { name: 'Photo piece to burn' })).toBeVisible({
    timeout: 60_000,
  });
  await card.getByRole('spinbutton', { name: 'Powers across' }).fill('3');
  await card.getByRole('spinbutton', { name: 'Speeds down' }).fill('2');
  await card.getByRole('spinbutton', { name: 'Square size (mm)' }).fill('10');
  await expect(card.getByRole('status', { name: 'Card summary' })).toContainText('6 squares');
  await page.screenshot({ path: testInfo.outputPath('photo-test-card.png') });
  // The project was saved a moment ago, so Generate has nothing to ask about.
  await card.getByRole('button', { name: 'Generate card', exact: true }).click();
  await expect(card).toBeHidden();

  const generated = await savedProject(page, kerfdesk);
  const squares = rasters(generated);
  expect(squares).toHaveLength(6);
  const first = squares[0];
  if (first === undefined) throw new Error('Missing square');
  for (const square of squares) {
    expect(square.source).toBe('photo-test-card-cell');
    // The same piece of the photo in every square.
    expect(square.lumaBase64).toBe(first.lumaBase64);
    expect(square.bounds).toEqual(first.bounds);
  }
  expect(first.bounds.maxX - first.bounds.minX).toBeCloseTo(10, 1);
  const rows = generated.scene.layers.filter((layer) => layer.mode === 'image');
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).toMatchObject({
      ditherAlgorithm: 'blue-noise',
      negativeImage: true,
      passThrough: false,
    });
  }
  const burns = squares.map((square) => {
    const operation = primaryOperationForObject(square, generated.scene.layers);
    if (operation === null) throw new Error('Square without an operation');
    const effective = effectiveOperationForObject(operation, square);
    return { power: effectiveObjectPowerPercent(effective, square), speed: effective.speed };
  });
  expect(new Set(burns.map((burn) => burn.power)).size).toBe(3);
  expect(new Set(burns.map((burn) => burn.speed)).size).toBe(2);
  // Three power labels across and two speed labels down are burned too.
  expect(generated.scene.objects.filter((object) => object.kind === 'imported-svg')).toHaveLength(
    5,
  );
  await page.screenshot({ path: testInfo.outputPath('photo-test-card-canvas.png') });

  // 2. Pick the strongest, slowest square and name the material.
  await toolsMenuCommand(page, 'Photo Test Card...');
  await expect(card).toContainText('Card cut from portrait.png');
  const picks = card.getByRole('radiogroup', { name: 'Burned squares' }).getByRole('radio');
  await expect(picks).toHaveCount(6);
  const best = picks.nth(5);
  const name = (await best.getAttribute('aria-label')) ?? '';
  const match = /^([\d.]+)% power at ([\d.]+) mm\/min$/.exec(name);
  if (match === null) throw new Error(`Unexpected square name: ${name}`);
  const power = Number(match[1]);
  const speed = Number(match[2]);
  expect(power).toBe(Math.max(...burns.map((burn) => burn.power)));
  expect(speed).toBe(Math.min(...burns.map((burn) => burn.speed)));
  await best.check();
  await expect(card).toContainText('on the edge of the card');
  await card.getByRole('textbox', { name: 'Tested material' }).fill('Black slate');
  await page.screenshot({ path: testInfo.outputPath('photo-test-pick.png') });
  await card.getByRole('button', { name: 'Save power and speed', exact: true }).click();
  await expect(card).toBeHidden();

  // 3. Burn a photo with the picked square's power and speed.
  await importPortrait(page, kerfdesk);
  await (await toolbarCommand(page, 'Photo engraving...')).click();
  const label = await tested.locator('option', { hasText: 'Black slate' }).textContent();
  expect(label).toBe(`Black slate · ${power}% · ${speed} mm/min`);
  await tested.selectOption({ label: label ?? '' });
  await expect(photo).toContainText('for this photo only');
  await page.screenshot({ path: testInfo.outputPath('photo-tested-burn.png') });
  await photo.getByRole('button', { name: 'Apply photo settings' }).click();
  await expect(photo).toBeHidden();

  const applied = await savedProject(page, kerfdesk);
  const image = rasters(applied).find((raster) => raster.source === 'portrait.png');
  if (image === undefined) throw new Error('Missing photo');
  const operation = primaryOperationForObject(image, applied.scene.layers);
  if (operation === null) throw new Error('Missing photo operation');
  const effective = effectiveOperationForObject(operation, image);
  expect(effectiveObjectPowerPercent(effective, image)).toBe(power);
  expect(effective.speed).toBe(speed);
  // The shared operation keeps its own power and speed.
  expect(image.operationOverride?.byOperation?.[operation.id]).toMatchObject({ power, speed });
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
