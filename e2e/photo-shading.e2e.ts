import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Project } from '../src/core/scene';
import { expect, test } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

const portrait = readFileSync(
  fileURLToPath(new URL('../src/__fixtures__/perceptual/assets/astronaut.png', import.meta.url)),
).toString('base64');

test.use({ trace: 'off', viewport: { width: 1440, height: 1000 } });

test('photo shading retains portrait tones through the real worker, preview and saved vectors', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as typeof window & { photoWorkerReady: number };
    state.photoWorkerReady = 0;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (!String(args[0]).includes('trace-worker')) return worker;
        const photoIds = new Set<number>();
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (message, transfer?: Transferable[] | StructuredSerializeOptions) => {
          if (message.options?.photoDetail !== undefined) photoIds.add(message.id);
          if (Array.isArray(transfer)) post(message, transfer);
          else post(message, transfer);
        };
        worker.addEventListener('message', (event: MessageEvent) => {
          if (event.data.kind === 'ok' && photoIds.has(event.data.id)) state.photoWorkerReady += 1;
        });
        return worker;
      },
    });
  });
  await page.goto('/');
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const file = new File([bytes], 'portrait.png', { type: 'image/png' });
    Object.assign(window, {
      showOpenFilePicker: async () => [
        { kind: 'file', name: file.name, getFile: async () => file },
      ],
    });
  }, portrait);
  await (await toolbarCommand(page, 'Import...')).click();
  const traceButton = await toolbarCommand(page, 'Trace Image...');
  await expect(traceButton).toBeEnabled({ timeout: 30_000 });
  await traceButton.click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Photo shading');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { photoWorkerReady: number }).photoWorkerReady,
      ),
    )
    .toBeGreaterThan(0);
  await expect(dialog.getByText(/Trace ready/)).toBeVisible();
  await expect(
    dialog.getByRole('spinbutton', { name: 'Trace Brightness', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Trace detection' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Show trace result' }).click();
  const preview = dialog.locator('.lf-trace-preview__vectors svg');
  const svg = await preview.evaluate((node) => node.outerHTML);
  expect(svg).toContain('fill="#000000"');
  const score = await page.evaluate(
    async ({ svg, portrait }) => {
      async function pixels(url: string, size: number): Promise<Uint8ClampedArray> {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(image, 0, 0, size, size);
        return ctx.getImageData(0, 0, size, size).data;
      }
      const source = await pixels(`data:image/png;base64,${portrait}`, 512);
      const sized = svg
        .replace('width="100%"', 'width="2048"')
        .replace('height="100%"', 'height="2048"');
      const rendered = await pixels(`data:image/svg+xml,${encodeURIComponent(sized)}`, 2048);
      let error = 0;
      let count = 0;
      // Face and hair, divided into independent 16px cells. Measure local mean
      // tone after real SVG rendering instead of asserting only path counts.
      for (let y = 48; y < 192; y += 16) {
        for (let x = 160; x < 304; x += 16) {
          let truth = 0;
          let actual = 0;
          for (let dy = 0; dy < 16; dy += 1) {
            for (let dx = 0; dx < 16; dx += 1) {
              const i = ((y + dy) * 512 + x + dx) * 4;
              truth +=
                (source[i]! * 0.2126 + source[i + 1]! * 0.7152 + source[i + 2]! * 0.0722) / 255;
            }
          }
          for (let dy = 0; dy < 64; dy += 1) {
            for (let dx = 0; dx < 64; dx += 1) {
              actual += rendered[((y * 4 + dy) * 2048 + x * 4 + dx) * 4]! / 255;
            }
          }
          error += Math.abs(truth / 256 - actual / 4096);
          count += 1;
        }
      }
      return { meanFaceToneError: error / count };
    },
    { svg, portrait },
  );
  expect(score.meanFaceToneError).toBeLessThan(0.04);
  writeFileSync(testInfo.outputPath('photo-shading.svg'), svg);
  writeFileSync(testInfo.outputPath('portrait-tone-score.json'), JSON.stringify(score, null, 2));
  await dialog.screenshot({ path: testInfo.outputPath('photo-shading-dialog.png') });
  await dialog.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await (await toolbarCommand(page, 'Save As...')).click();
  const saved = Object.values(await kerfdesk.savedFiles()).find((text) =>
    text.includes('traced-image'),
  );
  expect(saved).toBeDefined();
  const project = JSON.parse(saved!) as Project;
  const traced = project.scene.objects.find((object) => object.kind === 'traced-image');
  expect(traced?.kind).toBe('traced-image');
  if (traced?.kind !== 'traced-image') throw new Error('Photo trace was not saved');
  expect(traced.traceMode).toBe('filled-contours');
  expect(traced.paths.flatMap((path) => path.polylines).every((line) => line.closed)).toBe(true);
  expect(project.scene.layers.some((layer) => layer.mode === 'fill')).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('photo-shading-canvas.png') });
  expect(errors).toEqual([]);
});

test('photo Raster scan keeps partial tones through the conversion worker and PNG encoding', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const file = new File([bytes], 'portrait.png', { type: 'image/png' });
    Object.assign(window, {
      showOpenFilePicker: async () => [
        { kind: 'file', name: file.name, getFile: async () => file },
      ],
    });
  }, portrait);
  await (await toolbarCommand(page, 'Import...')).click();
  const traceButton = await toolbarCommand(page, 'Trace Image...');
  await expect(traceButton).toBeEnabled({ timeout: 30_000 });
  await traceButton.click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Photo shading');
  await dialog.getByRole('combobox', { name: 'Trace output' }).selectOption('raster');
  await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 30_000 });
  const artwork = await dialog.locator('.lf-trace-preview__artwork').boundingBox();
  if (artwork === null) throw new Error('Missing photo preview');
  await page.mouse.move(artwork.x + artwork.width * 0.25, artwork.y + artwork.height * 0.05);
  await page.mouse.down();
  await page.mouse.move(artwork.x + artwork.width * 0.7, artwork.y + artwork.height * 0.55);
  await page.mouse.up();
  const boundary = dialog.getByRole('combobox', { name: 'Trace boundary mode' });
  await expect(boundary.locator('option')).toHaveText(['Crop region']);
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Line Art');
  await boundary.selectOption('enhance');
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Photo shading');
  await expect(boundary).toHaveValue('crop');
  await expect(boundary.locator('option')).toHaveText(['Crop region']);
  await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await (await toolbarCommand(page, 'Save As...')).click();
  const saved = Object.values(await kerfdesk.savedFiles()).find((text) =>
    text.includes('raster-image'),
  );
  const project = JSON.parse(saved!) as Project;
  const raster = project.scene.objects.find((object) => object.kind === 'raster-image');
  if (raster?.kind !== 'raster-image' || raster.lumaBase64 === undefined) {
    throw new Error('Missing saved photo raster');
  }
  expect(project.scene.objects).toHaveLength(1);
  const luma = Buffer.from(raster.lumaBase64, 'base64');
  const partial = luma.filter((value) => value > 0 && value < 255).length;
  expect(partial / luma.length).toBeGreaterThan(0.15);
  expect(new Set(luma).size).toBeGreaterThan(30);
  const pngMatches = await page.evaluate(async (raster) => {
    const image = new Image();
    if (raster.dataUrl === undefined) throw new Error('Missing saved photo PNG');
    image.src = raster.dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = raster.pixelWidth;
    canvas.height = raster.pixelHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const expected = atob(raster.lumaBase64!);
    for (let i = 0; i < expected.length; i += 1) {
      if (pixels[i * 4] !== expected.charCodeAt(i)) return false;
    }
    return true;
  }, raster);
  expect(pngMatches).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('photo-shading-raster.png') });
  expect(errors).toEqual([]);
});
