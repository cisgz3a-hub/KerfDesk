import { readFileSync } from 'node:fs';
import type { Project } from '../src/core/scene';
import { expect, test } from './fixtures/kerfdesk-test';
import { saveProjectAs } from './fixtures/project-save';

test('imports a PSD composite through the worker and preserves artwork on decode failure', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const valid = readFileSync('src/__fixtures__/psd/rgb-rle-anisotropic.psd');
  const invalid = Buffer.from(valid);
  invalid.writeUInt16BE(16, 22);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto('/');
  await page.evaluate(
    ({ validBytes, invalidBytes }) => {
      let opened = 0;
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => {
          const good = opened++ === 0;
          const file = new File(
            [Uint8Array.from(good ? validBytes : invalidBytes)],
            good ? 'artwork-300x150dpi.psd' : 'unsupported-16bit.psd',
            { type: 'image/vnd.adobe.photoshop' },
          );
          return [{ kind: 'file', name: file.name, getFile: async () => file }];
        },
      });
    },
    { validBytes: [...valid], invalidBytes: [...invalid] },
  );
  await page.getByRole('button', { name: 'Import...', exact: true }).click();
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
  await expect(page.getByText(/Added merged PSD image: artwork-300x150dpi/)).toBeVisible();
  expect(workers.some((url) => url.includes('import-worker'))).toBe(true);
  const snapshot = async (): Promise<string> => {
    await saveProjectAs(page, kerfdesk);
    const saved = Object.values(await kerfdesk.savedFiles());
    const project = JSON.parse(saved.at(-1) ?? '{}') as Project;
    return JSON.stringify(project.scene);
  };
  const before = await snapshot();
  expect(before).toContain('raster-image');
  expect(before).toContain('data:image/png;base64,');
  const scene = JSON.parse(before) as Project['scene'];
  const raster = scene.objects[0];
  expect(raster?.kind).toBe('raster-image');
  if (raster?.kind !== 'raster-image') throw new Error('Missing imported PSD raster.');
  expect([raster.pixelWidth, raster.pixelHeight]).toEqual([300, 180]);
  expect(raster.bounds.maxX - raster.bounds.minX).toBeCloseTo(25.4, 6);
  expect(raster.bounds.maxY - raster.bounds.minY).toBeCloseTo(30.48, 6);
  expect(Buffer.from(raster.lumaBase64 ?? '', 'base64')).toHaveLength(300 * 180);
  await page.screenshot({ path: testInfo.outputPath('psd-composite-import.png') });
  await page.getByRole('button', { name: 'Import...', exact: true }).click();
  await expect(
    page.getByText(/unsupported-16bit.psd: PSD import supports 8-bit samples/),
  ).toBeVisible();
  expect(await snapshot()).toBe(before);
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
});
