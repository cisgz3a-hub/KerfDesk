// Image Studio adjustment preview at display resolution (ADR-245 Amendment 1,
// perf audit S5-P2-1): at fit view the dialog previews an averaged window,
// Cancel restores the canvas exactly, and at 100% the preview is pixel-for-
// pixel what OK applies. Neighbourhood filters on the photo render in a
// worker behind a progress bar with Cancel (Amendment 2).

import { toolbarCommand } from './fixtures/workspace-ui';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PHOTO_WIDTH_PX = 2400;
const PHOTO_HEIGHT_PX = 1800;
const SAMPLE_COLUMNS = 48;
const SAMPLE_ROWS = 32;
const BACKDROP_GREY = 51;
const NEAR_BLACK = 24;
const NEAR_WHITE = 231;
const PNG_BASE64 = readFileSync(
  join(process.cwd(), 'src', '__fixtures__', 'perceptual', 'assets', 'astronaut.png'),
).toString('base64');

test('Image Studio previews Threshold on screen and OK applies what 100% showed', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await installLargePhotoPicker(page);
  await page.goto('/');
  await (await toolbarCommand(page, 'Import...')).click();
  await page
    .getByRole('tablist', { name: 'Edit artwork or operation' })
    .getByRole('tab', { name: 'Artwork', exact: true })
    .click();
  await page.getByRole('button', { name: /^Edit Image/ }).click();
  const editor = page.getByRole('dialog', { name: /^Image Studio/ });
  await expect(editor).toBeVisible();
  await expect(editor).toContainText(`${PHOTO_WIDTH_PX}×${PHOTO_HEIGHT_PX}`);
  await expect(
    page.getByRole('button', { name: /^Dismiss success notification: Added image:/ }),
  ).toHaveCount(0);
  await expect.poll(async () => (await samples(page)).length).toBeGreaterThan(0);
  const original = await settledSamples(page);
  expect(binaryShare(original)).toBeLessThan(0.5);

  // Fit view: the averaged window preview thresholds the photo; Cancel restores it.
  const dialog = await openThreshold(page);
  await page.getByRole('slider', { name: 'Level', exact: true }).fill('150');
  await expect.poll(async () => binaryShare(await samples(page))).toBeGreaterThan(0.9);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => sameSamples(await samples(page), original)).toBe(true);

  // 100%: the preview window is a crop of the full-resolution result.
  await editor.getByRole('button', { name: '100%', exact: true }).click();
  const unzoomed = await settledSamples(page);
  const zoomedDialog = await openThreshold(page);
  await page.getByRole('slider', { name: 'Level', exact: true }).fill('150');
  await expect.poll(async () => binaryShare(await samples(page))).toBeGreaterThan(0.9);
  const previewed = await settledSamples(page);
  expect(sameSamples(previewed, unzoomed)).toBe(false);
  await zoomedDialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(zoomedDialog).toHaveCount(0);
  await expect(editor.getByRole('complementary', { name: 'History panel' })).toContainText(
    'Threshold',
  );
  await expect.poll(async () => sameSamples(await samples(page), previewed)).toBe(true);
});

// ADR-245 Amendment 2: neighbourhood filters on a large photo render in a
// worker. The dialog shows a progress bar with Cancel at once; Cancel stops
// the render and turns Preview off; at 100% the finished preview is pixel-for-
// pixel what OK applies. The worker's script is held back while the bar is
// checked, so the render cannot finish before Cancel is pressed.
test('Image Studio renders Halftone in a worker with a progress bar and Cancel', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await installLargePhotoPicker(page);
  let holdWorker = true;
  // The worker script only: its client and protocol modules load with the dialog.
  await page.route(/adjust-filter-worker(?!-client|-protocol)/, async (route) => {
    while (holdWorker) await new Promise((resolve) => setTimeout(resolve, 50));
    await route.continue();
  });
  await page.goto('/');
  await (await toolbarCommand(page, 'Import...')).click();
  await page
    .getByRole('tablist', { name: 'Edit artwork or operation' })
    .getByRole('tab', { name: 'Artwork', exact: true })
    .click();
  await page.getByRole('button', { name: /^Edit Image/ }).click();
  const editor = page.getByRole('dialog', { name: /^Image Studio/ });
  await expect(editor).toContainText(`${PHOTO_WIDTH_PX}×${PHOTO_HEIGHT_PX}`);
  await editor.getByRole('button', { name: '100%', exact: true }).click();
  await expect.poll(async () => (await samples(page)).length).toBeGreaterThan(0);
  const unzoomed = await settledSamples(page);
  expect(binaryShare(unzoomed)).toBeLessThan(0.5);

  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Halftone \(Dots\)/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Halftone (Dots)', exact: true });
  const bar = dialog.getByRole('progressbar', { name: 'Preview render progress' });
  await expect(bar).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('Rendering preview');

  // Cancel stops the render and turns Preview off: the canvas shows the photo.
  await dialog.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  await expect(bar).toHaveCount(0);
  const previewToggle = dialog.getByRole('checkbox', { name: 'Preview on canvas' });
  await expect(previewToggle).not.toBeChecked();
  await expect.poll(async () => sameSamples(await samples(page), unzoomed)).toBe(true);

  // Preview on again: the worker renders, the bar goes, and OK applies it exactly.
  holdWorker = false;
  await previewToggle.check();
  await expect.poll(async () => binaryShare(await samples(page))).toBeGreaterThan(0.9);
  await expect(bar).toHaveCount(0);
  const previewed = await settledSamples(page);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editor.getByRole('complementary', { name: 'History panel' })).toContainText(
    'Halftone',
  );
  await expect.poll(async () => sameSamples(await samples(page), previewed)).toBe(true);
});

async function installLargePhotoPicker(page: Page): Promise<void> {
  await page.addInitScript(
    ({ pngBase64, width, height }) => {
      const bytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => {
          // Enlarged in the page so the photo is bigger than the canvas at fit view.
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = new OffscreenCanvas(width, height);
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          const file = new File([blob], 'adjust-preview.png', { type: 'image/png' });
          return [{ kind: 'file', name: file.name, getFile: async () => file }];
        },
      });
    },
    { pngBase64: PNG_BASE64, width: PHOTO_WIDTH_PX, height: PHOTO_HEIGHT_PX },
  );
}

async function openThreshold(page: Page) {
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Threshold/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Threshold', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** RGB of a grid of document-canvas points (the dialog floats above, not on, the canvas). */
async function samples(page: Page): Promise<number[][]> {
  return page.getByLabel('Image Studio document canvas').evaluate(
    (canvas: HTMLCanvasElement, grid) => {
      const context = canvas.getContext('2d');
      if (context === null || canvas.width === 0) return [];
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const out: number[][] = [];
      for (let row = 0; row < grid.rows; row += 1) {
        for (let column = 0; column < grid.columns; column += 1) {
          const x = Math.floor(((column + 0.5) * canvas.width) / grid.columns);
          const y = Math.floor(((row + 0.5) * canvas.height) / grid.rows);
          const base = (y * canvas.width + x) * 4;
          out.push([image.data[base] ?? 0, image.data[base + 1] ?? 0, image.data[base + 2] ?? 0]);
        }
      }
      return out;
    },
    { columns: SAMPLE_COLUMNS, rows: SAMPLE_ROWS },
  );
}

/** Samples once two reads in a row agree (the canvas has finished redrawing). */
async function settledSamples(page: Page): Promise<number[][]> {
  let previous = await samples(page);
  await expect
    .poll(async () => {
      const next = await samples(page);
      const same = sameSamples(next, previous);
      previous = next;
      return same;
    })
    .toBe(true);
  return previous;
}

function sameSamples(a: number[][], b: number[][]): boolean {
  return a.length === b.length && a.every((rgb, i) => rgb.join() === b[i]?.join());
}

/** Share of document (non-backdrop) samples that are near-black or near-white grey. */
function binaryShare(points: number[][]): number {
  const doc = points.filter((rgb) => rgb.some((value) => value !== BACKDROP_GREY));
  const binary = doc.filter(
    (rgb) => rgb.every((value) => value <= NEAR_BLACK) || rgb.every((value) => value >= NEAR_WHITE),
  );
  return doc.length === 0 ? 0 : binary.length / doc.length;
}
