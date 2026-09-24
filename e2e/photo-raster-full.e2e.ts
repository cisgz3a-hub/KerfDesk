import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Project } from '../src/core/scene';
import { expect, test } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

const portrait = readFileSync(
  fileURLToPath(new URL('../src/__fixtures__/perceptual/assets/astronaut.png', import.meta.url)),
).toString('base64');

test.use({ trace: 'off', viewport: { width: 1366, height: 768 } });

for (const detail of [60, 100]) {
  test(`full Photo shading at Detail ${detail} commits through the bitmap worker`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([bytes], 'full-portrait.png', { type: 'image/png' });
      Object.assign(window, {
        showOpenFilePicker: async () => [
          { kind: 'file', name: file.name, getFile: async () => file },
        ],
      });
    }, portrait);
    await (await toolbarCommand(page, 'Import...')).click();
    const trace = await toolbarCommand(page, 'Trace Image...');
    await expect(trace).toBeEnabled({ timeout: 30_000 });
    const width = page.getByRole('spinbutton', { name: 'Selection width', exact: true });
    const height = page.getByRole('spinbutton', { name: 'Selection height', exact: true });
    await width.fill('64');
    await width.blur();
    await height.fill('64');
    await height.blur();
    await trace.click();
    const dialog = page.getByRole('dialog', { name: 'Trace image' });
    await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Photo shading');
    const detailControl = dialog.getByRole('spinbutton', { name: 'Trace Detail', exact: true });
    await detailControl.fill(String(detail));
    await detailControl.blur();
    await dialog.getByRole('combobox', { name: 'Trace output' }).selectOption('raster');
    await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Trace', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await (await toolbarCommand(page, 'Save As...')).click();
    await page.waitForFunction(() => {
      const saved = (
        window as typeof window & { __KERFDESK_E2E__: { savedFiles: Record<string, string> } }
      ).__KERFDESK_E2E__.savedFiles;
      return Object.values(saved).some((value) => value.includes('raster-image'));
    });

    // Inspect the saved artifact inside the browser. Copying an entire dense
    // project back to the runner can dominate the operation being measured.
    const summary = await page.evaluate(async () => {
      const saved = (
        window as typeof window & { __KERFDESK_E2E__: { savedFiles: Record<string, string> } }
      ).__KERFDESK_E2E__.savedFiles;
      const text = Object.values(saved).find((value) => value.includes('raster-image'));
      if (text === undefined) throw new Error('Missing saved full photo');
      const project = JSON.parse(text) as Project;
      const raster = project.scene.objects.find((object) => object.kind === 'raster-image');
      if (raster?.kind !== 'raster-image' || raster.lumaBase64 === undefined) {
        throw new Error('Missing full photo raster luminance');
      }
      if (raster.dataUrl === undefined) throw new Error('Missing full photo PNG');
      const luma = atob(raster.lumaBase64);
      const levels = new Set<number>();
      let partial = 0;
      for (let i = 0; i < luma.length; i += 1) {
        const value = luma.charCodeAt(i);
        levels.add(value);
        if (value > 0 && value < 255) partial += 1;
      }
      const image = new Image();
      image.src = raster.dataUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = raster.pixelWidth;
      canvas.height = raster.pixelHeight;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Missing full photo comparison canvas');
      context.drawImage(image, 0, 0);
      const png = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let pngMatches = true;
      for (let i = 0; i < luma.length; i += 1) {
        if (png[i * 4] !== luma.charCodeAt(i)) pngMatches = false;
      }
      return {
        objects: project.scene.objects.length,
        width: raster.pixelWidth,
        height: raster.pixelHeight,
        partialFraction: partial / luma.length,
        tonalLevels: levels.size,
        pngMatches,
        imageOperation: project.scene.layers.some((layer) => layer.mode === 'image'),
      };
    });
    expect(summary.objects).toBe(1);
    expect(summary.width).toBe(640);
    expect(summary.height).toBe(summary.width);
    expect(summary.partialFraction).toBeGreaterThan(0.15);
    expect(summary.tonalLevels).toBeGreaterThan(30);
    expect(summary.pngMatches).toBe(true);
    expect(summary.imageOperation).toBe(true);
    expect(errors).toEqual([]);
    writeFileSync(testInfo.outputPath('full-photo-summary.json'), JSON.stringify(summary, null, 2));
    await page.screenshot({ path: testInfo.outputPath('full-photo-raster.png') });
  });
}
