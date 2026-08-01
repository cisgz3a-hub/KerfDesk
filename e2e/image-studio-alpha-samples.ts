import type { Locator } from '@playwright/test';

const RGBA_CHANNELS = 4;
const PATCH_WIDTH_PX = 240;
const PATCH_HEIGHT_PX = 120;
const TEXT_CHANGE_THRESHOLD = 8;
const TRANSPARENT_SAMPLE_COUNT = 5;
const TRANSPARENT_NEIGHBOUR_RADIUS_PX = 2;

interface CanvasPatch {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly number[];
}

/** One exact canvas coordinate whose text-layer source and destination are transparent. */
export interface TransparentCanvasSample {
  readonly x: number;
  readonly y: number;
  readonly rgba: readonly number[];
}

/** Capture a bounded patch around the document centre where raster text is placed. */
export async function captureTextCanvasPatch(canvas: Locator): Promise<CanvasPatch> {
  return canvas.evaluate(
    (element: HTMLCanvasElement, size) => {
      const context = element.getContext('2d');
      if (context === null) throw new Error('Image Studio canvas has no 2D context');
      const width = Math.min(size.width, element.width);
      const height = Math.min(size.height, element.height);
      const x = Math.floor((element.width - width) / 2);
      const y = Math.floor((element.height - height) / 2);
      const image = context.getImageData(x, y, width, height);
      return { x, y, width, height, pixels: Array.from(image.data) };
    },
    { width: PATCH_WIDTH_PX, height: PATCH_HEIGHT_PX },
  );
}

/** Convert a horizontal CSS drag into the canvas backing-store distance. */
export async function canvasHorizontalDistance(
  canvas: Locator,
  cssDistancePx: number,
): Promise<number> {
  return canvas.evaluate((element: HTMLCanvasElement, distance) => {
    const cssWidth = element.getBoundingClientRect().width;
    return cssWidth <= 0 ? distance : (distance * element.width) / cssWidth;
  }, cssDistancePx);
}

/**
 * Select deterministic transparent pixels inside the rendered text bounds.
 *
 * Candidates must retain the base image before text, and their translated
 * source neighbourhood must also be transparent so a rightward preview/commit
 * cannot legitimately paint them.
 */
export function transparentTextCanvasSamples(
  base: CanvasPatch,
  withText: CanvasPatch,
  horizontalShiftPx: number,
): readonly TransparentCanvasSample[] {
  assertMatchingPatches(base, withText);
  const bounds = textChangeBounds(base, withText);
  if (bounds === null) return [];
  const shift = Math.round(horizontalShiftPx);
  const candidates: TransparentCanvasSample[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (
        patchNeighbourMatches(base, withText, x, y) &&
        patchNeighbourMatches(base, withText, x - shift, y)
      ) {
        candidates.push({
          x: base.x + x,
          y: base.y + y,
          rgba: patchRgba(base, x, y),
        });
      }
    }
  }
  return spreadSamples(candidates, TRANSPARENT_SAMPLE_COUNT);
}

/** Read exact RGBA values at previously selected canvas coordinates. */
export async function canvasRgbaSamples(
  canvas: Locator,
  samples: readonly TransparentCanvasSample[],
): Promise<readonly (readonly number[])[]> {
  return canvas.evaluate(
    (element: HTMLCanvasElement, input) => {
      const context = element.getContext('2d');
      if (context === null) throw new Error('Image Studio canvas has no 2D context');
      const image = context.getImageData(0, 0, element.width, element.height);
      return input.coordinates.map(({ x, y }) => {
        const base = (y * element.width + x) * input.channels;
        return Array.from(image.data.slice(base, base + input.channels));
      });
    },
    { coordinates: samples, channels: RGBA_CHANNELS },
  );
}

function textChangeBounds(
  base: CanvasPatch,
  withText: CanvasPatch,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = base.width;
  let minY = base.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < base.height; y += 1) {
    for (let x = 0; x < base.width; x += 1) {
      if (!patchPixelChanged(base, withText, x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function patchNeighbourMatches(
  base: CanvasPatch,
  withText: CanvasPatch,
  x: number,
  y: number,
): boolean {
  for (let dy = -TRANSPARENT_NEIGHBOUR_RADIUS_PX; dy <= TRANSPARENT_NEIGHBOUR_RADIUS_PX; dy += 1) {
    for (
      let dx = -TRANSPARENT_NEIGHBOUR_RADIUS_PX;
      dx <= TRANSPARENT_NEIGHBOUR_RADIUS_PX;
      dx += 1
    ) {
      const sampleX = x + dx;
      const sampleY = y + dy;
      if (
        sampleX < 0 ||
        sampleY < 0 ||
        sampleX >= base.width ||
        sampleY >= base.height ||
        !patchPixelsEqual(base, withText, sampleX, sampleY)
      ) {
        return false;
      }
    }
  }
  return true;
}

function patchPixelChanged(
  base: CanvasPatch,
  withText: CanvasPatch,
  x: number,
  y: number,
): boolean {
  const offset = (y * base.width + x) * RGBA_CHANNELS;
  for (let channel = 0; channel < RGBA_CHANNELS; channel += 1) {
    if (
      Math.abs((base.pixels[offset + channel] ?? 0) - (withText.pixels[offset + channel] ?? 0)) >
      TEXT_CHANGE_THRESHOLD
    ) {
      return true;
    }
  }
  return false;
}

function patchPixelsEqual(first: CanvasPatch, second: CanvasPatch, x: number, y: number): boolean {
  const offset = (y * first.width + x) * RGBA_CHANNELS;
  for (let channel = 0; channel < RGBA_CHANNELS; channel += 1) {
    if ((first.pixels[offset + channel] ?? 0) !== (second.pixels[offset + channel] ?? 0)) {
      return false;
    }
  }
  return true;
}

function patchRgba(patch: CanvasPatch, x: number, y: number): readonly number[] {
  const offset = (y * patch.width + x) * RGBA_CHANNELS;
  return patch.pixels.slice(offset, offset + RGBA_CHANNELS);
}

function spreadSamples(
  candidates: readonly TransparentCanvasSample[],
  count: number,
): readonly TransparentCanvasSample[] {
  if (candidates.length <= count) return candidates;
  return Array.from({ length: count }, (_, index) => {
    const candidateIndex = Math.round((index * (candidates.length - 1)) / (count - 1));
    return candidates[candidateIndex] as TransparentCanvasSample;
  });
}

function assertMatchingPatches(first: CanvasPatch, second: CanvasPatch): void {
  if (
    first.x !== second.x ||
    first.y !== second.y ||
    first.width !== second.width ||
    first.height !== second.height
  ) {
    throw new Error('Image Studio canvas patch changed dimensions');
  }
}
