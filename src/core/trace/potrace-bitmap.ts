import type { LightBurnTraceSettings } from './potrace-params';
import type { RawImageData } from './trace-image';

export type TraceBitmap = {
  readonly width: number;
  readonly height: number;
  /** 1 = foreground ink, 0 = background */
  readonly data: Uint8Array;
};

function clampByte(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampPixelCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function lumaByte(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

export function lightBurnTraceBitmapFromImage(
  image: RawImageData,
  settings: LightBurnTraceSettings = {},
): TraceBitmap {
  const pixelCount = image.width * image.height;
  const cutoff = clampByte(settings.cutoffLuma, 0);
  const threshold = clampByte(settings.thresholdLuma, 128);
  const lo = Math.min(cutoff, threshold);
  const hi = Math.max(cutoff, threshold);
  const data = new Uint8Array(pixelCount);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const r = image.data[offset] ?? 255;
    const g = image.data[offset + 1] ?? 255;
    const b = image.data[offset + 2] ?? 255;
    const luma = lumaByte(r, g, b);
    data[pixel] = luma >= lo && luma <= hi ? 1 : 0;
  }

  return removeSmallInkRegions(
    { width: image.width, height: image.height, data },
    clampPixelCount(settings.ignoreLessThanPixels),
  );
}

export function removeSmallInkRegions(bitmap: TraceBitmap, turdsize: number): TraceBitmap {
  const limit = clampPixelCount(turdsize);
  const size = bitmap.width * bitmap.height;
  const data = new Uint8Array(bitmap.data);
  if (limit <= 0 || size === 0) {
    return { width: bitmap.width, height: bitmap.height, data };
  }

  const visited = new Uint8Array(size);
  const stack: number[] = [];
  const component: number[] = [];

  for (let start = 0; start < size; start += 1) {
    if (!isUnvisitedInk(bitmap, visited, start)) continue;
    collectInkComponent(bitmap, start, visited, stack, component);

    if (component.length <= limit) {
      for (const index of component) {
        data[index] = 0;
      }
    }
  }

  return { width: bitmap.width, height: bitmap.height, data };
}

function collectInkComponent(
  bitmap: TraceBitmap,
  start: number,
  visited: Uint8Array,
  stack: number[],
  component: number[],
): void {
  stack.length = 0;
  component.length = 0;
  stack.push(start);
  visited[start] = 1;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    component.push(current);
    pushUnvisitedInkNeighbors(bitmap, current, visited, stack);
  }
}

function pushUnvisitedInkNeighbors(
  bitmap: TraceBitmap,
  current: number,
  visited: Uint8Array,
  stack: number[],
): void {
  for (const next of inkNeighborIndexes(bitmap, current)) {
    if (!isUnvisitedInk(bitmap, visited, next)) continue;
    visited[next] = 1;
    stack.push(next);
  }
}

function inkNeighborIndexes(bitmap: TraceBitmap, current: number): number[] {
  const x = current % bitmap.width;
  const y = Math.floor(current / bitmap.width);
  const neighbors: number[] = [];
  if (x > 0) neighbors.push(current - 1);
  if (x + 1 < bitmap.width) neighbors.push(current + 1);
  if (y > 0) neighbors.push(current - bitmap.width);
  if (y + 1 < bitmap.height) neighbors.push(current + bitmap.width);
  return neighbors;
}

function isUnvisitedInk(bitmap: TraceBitmap, visited: Uint8Array, index: number): boolean {
  return visited[index] !== 1 && bitmap.data[index] === 1;
}

export function traceBitmapToMonochrome(bitmap: TraceBitmap): RawImageData {
  const data = new Uint8ClampedArray(bitmap.width * bitmap.height * 4);
  for (let i = 0; i < bitmap.data.length; i += 1) {
    const value = bitmap.data[i] === 1 ? 0 : 255;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { width: bitmap.width, height: bitmap.height, data };
}

export function lightBurnTraceBitmapToMonochrome(
  image: RawImageData,
  settings: LightBurnTraceSettings = {},
): RawImageData {
  return traceBitmapToMonochrome(lightBurnTraceBitmapFromImage(image, settings));
}
