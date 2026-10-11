import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { effectiveOperationForObject } from '../src/core/effective-output';
import { primaryOperationForObject, type Project } from '../src/core/scene';
import { expect, test, type KerfDeskFixture } from './fixtures/kerfdesk-test';
import { saveProjectAs } from './fixtures/project-save';
import { toolbarCommand } from './fixtures/workspace-ui';

const portrait = readFileSync(
  fileURLToPath(new URL('../src/__fixtures__/perceptual/assets/astronaut.png', import.meta.url)),
).toString('base64');

test.use({ viewport: { width: 1440, height: 1000 } });

test('portrait photo workflow previews real dots, cancels, persists and undoes one photo edit', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'portrait.png', base64: portrait, mimeType: 'image/png' }]);
  await (await toolbarCommand(page, 'Import...')).click();
  const photoButton = await toolbarCommand(page, 'Photo engraving...');
  await expect(photoButton).toBeEnabled({ timeout: 30_000 });
  const baseline = await savedProject(page, kerfdesk);
  await photoButton.click();
  const dialog = page.getByRole('dialog', { name: 'Photo engraving', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Photo processing' })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Photo processing' }).selectOption('jarvis');
  await dialog.getByRole('spinbutton', { name: 'Photo engraving DPI' }).fill('127');
  await dialog.getByRole('spinbutton', { name: 'Photo engraving DPI' }).blur();
  const canvas = dialog.getByLabel('Photo engraving preview', { exact: true });
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const coarse = await canvas.evaluate((node) => ({
    width: (node as HTMLCanvasElement).width,
    pixels: (node as HTMLCanvasElement).toDataURL(),
  }));
  expect(await portraitToneError(page)).toBeLessThan(15);
  await page.screenshot({ path: testInfo.outputPath('portrait-photo-engraving.png') });

  await dialog.getByRole('spinbutton', { name: 'Photo engraving DPI' }).fill('203.2');
  await dialog.getByRole('spinbutton', { name: 'Photo engraving DPI' }).blur();
  await expect
    .poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).width))
    .toBeGreaterThan(coarse.width);
  await expect
    .poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL()))
    .not.toBe(coarse.pixels);
  await dialog.getByRole('combobox', { name: 'Material marking' }).selectOption('light');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  expect(await portraitToneError(page)).toBeLessThan(15);
  await page.screenshot({ path: testInfo.outputPath('portrait-light-marks.png') });

  await dialog.getByRole('combobox', { name: 'Material marking' }).selectOption('dark');
  await dialog.getByRole('spinbutton', { name: 'Photo engraving DPI' }).fill('300');
  await dialog.getByRole('spinbutton', { name: 'Photo engraving DPI' }).blur();
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).width)).toBe(512);
  expect(await portraitToneError(page)).toBeLessThan(15);
  await page.screenshot({ path: testInfo.outputPath('portrait-photo-engraving-detail.png') });

  await page.setViewportSize({ width: 800, height: 900 });
  await expect(dialog.getByRole('button', { name: 'Apply photo settings' })).toBeVisible();
  expect(
    await dialog
      .locator('.lf-photo-engraving')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('portrait-photo-engraving-narrow.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await savedProject(page, kerfdesk)).scene).toEqual(baseline.scene);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await (await toolbarCommand(page, 'Photo engraving...')).click();
  await dialog.getByRole('combobox', { name: 'Photo processing' }).selectOption('stucki');
  await dialog.getByRole('combobox', { name: 'Material marking' }).selectOption('light');
  await dialog.getByRole('spinbutton', { name: 'Photo midtones (gamma)' }).fill('1.2');
  await dialog.getByRole('spinbutton', { name: 'Photo midtones (gamma)' }).blur();
  await dialog.getByRole('button', { name: 'Apply photo settings' }).click();
  await expect(dialog).toBeHidden();
  const applied = await savedProject(page, kerfdesk);
  const image = applied.scene.objects.find((object) => object.kind === 'raster-image');
  const original = baseline.scene.objects.find((object) => object.kind === 'raster-image');
  if (image?.kind !== 'raster-image' || original?.kind !== 'raster-image')
    throw new Error('Missing imported photo');
  const operation = primaryOperationForObject(image, applied.scene.layers);
  if (operation === null) throw new Error('Missing photo operation');
  expect(effectiveOperationForObject(operation, image)).toMatchObject({
    mode: 'image',
    ditherAlgorithm: 'stucki',
    negativeImage: true,
    passThrough: false,
  });
  expect(image.gamma).toBe(1.2);
  expect(image.dataUrl).toBe(original.dataUrl);
  expect(image.lumaBase64).toBe(original.lumaBase64);
  expect(applied.scene.layers).toEqual(baseline.scene.layers);

  await page.keyboard.press('Control+z');
  expect((await savedProject(page, kerfdesk)).scene).toEqual(baseline.scene);
  expect((await kerfdesk.events()).some((event) => event.kind.startsWith('serial-'))).toBe(false);
  expect(errors).toEqual([]);
});

async function savedProject(page: Page, fixture: KerfDeskFixture): Promise<Project> {
  await saveProjectAs(page, fixture);
  const saved = Object.values(await fixture.savedFiles()).find((text) =>
    text.includes('raster-image'),
  );
  if (saved === undefined) throw new Error('Missing saved photo project');
  return JSON.parse(saved) as Project;
}

// Independent spatial tone check on the displayed real portrait: catches an
// upside-down machine-frame preview as well as lost face/skin/hair midtones.
async function portraitToneError(page: Page): Promise<number> {
  return page.getByRole('dialog', { name: 'Photo engraving', exact: true }).evaluate((dialog) => {
    const original = dialog.querySelector('img');
    const preview = dialog.querySelector('canvas');
    if (!(original instanceof HTMLImageElement) || !(preview instanceof HTMLCanvasElement))
      throw new Error('Missing portrait previews');
    const source = document.createElement('canvas');
    source.width = original.naturalWidth;
    source.height = original.naturalHeight;
    const context = source.getContext('2d');
    const result = preview.getContext('2d');
    if (context === null || result === null) throw new Error('Missing portrait pixels');
    context.drawImage(original, 0, 0);
    const a = context.getImageData(0, 0, source.width, source.height);
    const b = result.getImageData(0, 0, preview.width, preview.height);
    function mean(data: ImageData, tileX: number, tileY: number): number {
      let sum = 0;
      let count = 0;
      for (
        let y = Math.floor((tileY * data.height) / 16);
        y < Math.floor(((tileY + 1) * data.height) / 16);
        y += 1
      ) {
        for (
          let x = Math.floor((tileX * data.width) / 16);
          x < Math.floor(((tileX + 1) * data.width) / 16);
          x += 1
        ) {
          const index = (y * data.width + x) * 4;
          sum +=
            (data.data[index] ?? 0) * 0.299 +
            (data.data[index + 1] ?? 0) * 0.587 +
            (data.data[index + 2] ?? 0) * 0.114;
          count += 1;
        }
      }
      return sum / Math.max(1, count);
    }
    let error = 0;
    for (let y = 0; y < 16; y += 1)
      for (let x = 0; x < 16; x += 1) error += Math.abs(mean(a, x, y) - mean(b, x, y));
    return error / 256;
  });
}
