import type { RasterImage } from '../src/core/scene';
import { expect, test, type Page } from './fixtures/kerfdesk-test';

declare global {
  interface Window {
    __bitmapConversionTest: {
      hold: boolean;
      requests: number;
      terminated: number;
      results: RasterImage[];
    };
  }
}

const overlappingSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="15mm" height="10mm" viewBox="0 0 15 10"><path fill="#000000" fill-rule="nonzero" d="M0 0H10V10H0Z M5 0H15V10H5Z"/></svg>`;

test.beforeEach(async ({ page, kerfdesk }) => {
  await page.addInitScript(() => {
    window.__bitmapConversionTest = { hold: false, requests: 0, terminated: 0, results: [] };
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (!String(args[0]).includes('convert-bitmap-worker')) return worker;
        const state = window.__bitmapConversionTest;
        const post = worker.postMessage.bind(worker);
        const terminate = worker.terminate.bind(worker);
        worker.postMessage = (message: unknown) => {
          state.requests += 1;
          if (!state.hold) post(message);
        };
        worker.terminate = () => {
          state.terminated += 1;
          terminate();
        };
        worker.addEventListener(
          'message',
          (event: MessageEvent<{ kind: string; raster?: RasterImage }>) => {
            if (event.data.kind === 'ok' && event.data.raster)
              state.results.push(event.data.raster);
          },
        );
        return worker;
      },
    });
  });
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'overlap.svg', text: overlappingSvg }]);
  await page.getByRole('button', { name: 'More commands', exact: true }).click();
  await page
    .getByRole('menu', { name: 'More commands', exact: true })
    .getByRole('menuitem', { name: 'Import...', exact: true })
    .click();
  await expectBitmapAvailable(page);
});

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'More commands', exact: true }).click();
  await page
    .getByRole('menu', { name: 'More commands', exact: true })
    .getByRole('menuitem', { name: 'Convert to Bitmap...', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Convert to Bitmap', exact: true });
}

async function expectBitmapAvailable(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More commands', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'More commands', exact: true });
  await expect(
    menu.getByRole('menuitem', { name: 'Convert to Bitmap...', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
}

test('native conversion preserves nonzero overlap and PNG pixels through Undo and Redo', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trace Image...', exact: true })).toBeEnabled();
  const result = await page.evaluate(async () => {
    const raster = window.__bitmapConversionTest.results[0];
    if (!raster?.lumaBase64 || !raster.dataUrl)
      throw new Error('Native worker did not return a bitmap');
    const image = new Image();
    image.src = raster.dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    const luma = Uint8Array.from(atob(raster.lumaBase64), (char) => char.charCodeAt(0));
    let mismatch = 0;
    for (let index = 0; index < luma.length; index += 1) {
      if (
        rgba[index * 4] !== luma[index] ||
        rgba[index * 4 + 1] !== luma[index] ||
        rgba[index * 4 + 2] !== luma[index] ||
        rgba[index * 4 + 3] !== 255
      )
        mismatch += 1;
    }
    return {
      width: image.width,
      height: image.height,
      mismatch,
      center: luma[Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)],
    };
  });
  expect(result).toEqual({ width: 150, height: 100, mismatch: 0, center: 127 });
  await page.screenshot({ path: testInfo.outputPath('converted.png') });
  await page.keyboard.press('Control+z');
  await expectBitmapAvailable(page);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('button', { name: 'Trace Image...', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('busy conversion prevents duplicate work, cancels with Escape, and can be retried', async ({
  page,
}, testInfo) => {
  await page.evaluate(() => {
    window.__bitmapConversionTest.hold = true;
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(dialog.getByRole('progressbar', { name: 'Converting to bitmap' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Converting…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('spinbutton', { name: 'Convert DPI', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+Shift+b');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.__bitmapConversionTest.requests)).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('converting.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('progressbar')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('converting-phone.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__bitmapConversionTest.terminated)).toBe(1);
  await expectBitmapAvailable(page);
  await page.evaluate(() => {
    window.__bitmapConversionTest.hold = false;
  });
  const retry = await openDialog(page);
  await retry.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(retry).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trace Image...', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__bitmapConversionTest.requests)).toBe(2);
});
