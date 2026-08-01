import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canvasHorizontalDistance,
  canvasRgbaSamples,
  captureTextCanvasPatch,
  transparentTextCanvasSamples,
} from './image-studio-alpha-samples';

const CANVAS_SAMPLE_COLUMNS = 40;
const CANVAS_SAMPLE_ROWS = 30;
const CANVAS_CHANNELS = 4;
const CANVAS_PIXEL_CHANGE_THRESHOLD = 40;
const MAX_TRANSFORM_CHANGED_PIXEL_RATIO = 0.2;
const TRANSFORM_DRAG_PX = 24;
const PNG_BASE64 = readFileSync(
  join(
    process.cwd(),
    'src',
    '__fixtures__',
    'perceptual',
    'assets',
    'arch-house-langebaan-source.png',
  ),
).toString('base64');

interface CanvasSample {
  readonly pixels: readonly number[];
}

test('Image Studio keeps transparent text transforms from covering the bitmap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installImageOpenPicker(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Image...' }).click();
  await page.getByRole('button', { name: /^Edit Image/ }).click();

  const editor = page.getByRole('dialog', { name: /^Image Studio/ });
  const canvas = page.getByLabel('Image Studio document canvas');
  await expect(editor).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width * element.height))
    .toBeGreaterThan(0);

  const baseTextPatch = await captureTextCanvasPatch(canvas);
  await editor.getByRole('button', { name: /^Text/ }).click();
  const textDialog = page.getByRole('dialog', { name: 'Add text' });
  await textDialog.getByLabel('Text content').fill('Alpha');
  await textDialog.getByLabel('Ink color').selectOption('white');
  await textDialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(textDialog).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await waitForTwoFrames(page);

  const textPatch = await captureTextCanvasPatch(canvas);
  const dragDistance = await canvasHorizontalDistance(canvas, TRANSFORM_DRAG_PX);
  const transparentSamples = transparentTextCanvasSamples(baseTextPatch, textPatch, dragDistance);
  expect(transparentSamples).toHaveLength(5);
  const expectedTransparentRgba = transparentSamples.map((sample) => sample.rgba);
  const beforeTransform = await imageStudioCanvasSample(page);
  await editor.focus();
  await page.keyboard.press('Control+t');
  await waitForTwoFrames(page);
  const duringTransform = await imageStudioCanvasSample(page);
  expect(await canvasRgbaSamples(canvas, transparentSamples)).toEqual(expectedTransparentRgba);
  expect(changedCanvasPixelRatio(beforeTransform, duringTransform)).toBeLessThan(
    MAX_TRANSFORM_CHANGED_PIXEL_RATIO,
  );

  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('Image Studio canvas has no bounds');
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + TRANSFORM_DRAG_PX, centerY);
  await page.mouse.up();
  await waitForTwoFrames(page);
  expect(await canvasRgbaSamples(canvas, transparentSamples)).toEqual(expectedTransparentRgba);
  await page.keyboard.press('Enter');
  await waitForTwoFrames(page);
  const committed = await imageStudioCanvasSample(page);
  expect(await canvasRgbaSamples(canvas, transparentSamples)).toEqual(expectedTransparentRgba);
  expect(changedCanvasPixelRatio(beforeTransform, committed)).toBeLessThan(
    MAX_TRANSFORM_CHANGED_PIXEL_RATIO,
  );

  await editor.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('Image edits applied.', { exact: true })).toBeVisible();
  await waitForTwoFrames(page);
  const applied = await imageStudioCanvasSample(page);
  expect(await canvasRgbaSamples(canvas, transparentSamples)).toEqual(expectedTransparentRgba);
  expect(changedCanvasPixelRatio(committed, applied)).toBeLessThan(
    MAX_TRANSFORM_CHANGED_PIXEL_RATIO,
  );
  await editor.focus();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});

async function installImageOpenPicker(page: Page): Promise<void> {
  await page.addInitScript((pngBase64) => {
    const bytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => {
        const file = new File([bytes], 'trace-source.png', { type: 'image/png' });
        return [{ kind: 'file', name: file.name, getFile: async () => file }];
      },
    });
  }, PNG_BASE64);
}

async function imageStudioCanvasSample(page: Page): Promise<CanvasSample> {
  return page.getByLabel('Image Studio document canvas').evaluate(
    (canvas: HTMLCanvasElement, grid) => {
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Image Studio canvas has no 2D context');
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels: number[] = [];
      for (let row = 0; row < grid.rows; row += 1) {
        for (let column = 0; column < grid.columns; column += 1) {
          const x = Math.min(
            canvas.width - 1,
            Math.floor(((column + 0.5) * canvas.width) / grid.columns),
          );
          const y = Math.min(
            canvas.height - 1,
            Math.floor(((row + 0.5) * canvas.height) / grid.rows),
          );
          const base = (y * canvas.width + x) * grid.channels;
          for (let channel = 0; channel < grid.channels; channel += 1) {
            pixels.push(image.data[base + channel] ?? 0);
          }
        }
      }
      return { pixels };
    },
    {
      columns: CANVAS_SAMPLE_COLUMNS,
      rows: CANVAS_SAMPLE_ROWS,
      channels: CANVAS_CHANNELS,
    },
  );
}

function changedCanvasPixelRatio(first: CanvasSample, second: CanvasSample): number {
  let changed = 0;
  const pixelCount = Math.min(first.pixels.length, second.pixels.length) / CANVAS_CHANNELS;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const base = pixel * CANVAS_CHANNELS;
    let isChanged = false;
    for (let channel = 0; channel < CANVAS_CHANNELS; channel += 1) {
      if (
        Math.abs((first.pixels[base + channel] ?? 0) - (second.pixels[base + channel] ?? 0)) >
        CANVAS_PIXEL_CHANGE_THRESHOLD
      ) {
        isChanged = true;
        break;
      }
    }
    if (isChanged) changed += 1;
  }
  return pixelCount === 0 ? 0 : changed / pixelCount;
}

async function waitForTwoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
