export interface TraceBitmap {
  width: number;
  height: number;
  /** 1 = foreground ink, 0 = background */
  data: Uint8Array;
}

export interface TraceImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface TraceBitmapOptions {
  threshold: number;
  cutoff?: number;
  turdsize?: number;
  invert?: boolean;
}

function clampByte(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampPixelCount(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function grayscaleToTraceBitmap(
  grayscaleData: Uint8Array,
  width: number,
  height: number,
  options: TraceBitmapOptions,
): TraceBitmap {
  const pixelCount = width * height;
  const cutoff = clampByte(options.cutoff ?? 0, 0);
  const threshold = clampByte(options.threshold, 128);
  const raw = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    let value = grayscaleData[i] ?? 255;
    if (options.invert) value = 255 - value;
    raw[i] = value >= cutoff && value <= threshold ? 1 : 0;
  }

  return removeSmallInkRegions({ width, height, data: raw }, clampPixelCount(options.turdsize));
}

export function removeSmallInkRegions(bitmap: TraceBitmap, turdsize: number): TraceBitmap {
  const limit = clampPixelCount(turdsize);
  const size = bitmap.width * bitmap.height;
  const result = new Uint8Array(bitmap.data);
  if (limit <= 0 || size === 0) {
    return { width: bitmap.width, height: bitmap.height, data: result };
  }

  const visited = new Uint8Array(size);
  const stack: number[] = [];
  const component: number[] = [];

  for (let start = 0; start < size; start++) {
    if (visited[start] || bitmap.data[start] === 0) continue;

    stack.length = 0;
    component.length = 0;
    stack.push(start);
    visited[start] = 1;

    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);

      const x = current % bitmap.width;
      const y = Math.floor(current / bitmap.width);
      const neighbors = [
        x > 0 ? current - 1 : -1,
        x + 1 < bitmap.width ? current + 1 : -1,
        y > 0 ? current - bitmap.width : -1,
        y + 1 < bitmap.height ? current + bitmap.width : -1,
      ];

      for (const next of neighbors) {
        if (next < 0 || visited[next] || bitmap.data[next] === 0) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }

    if (component.length <= limit) {
      for (const index of component) {
        result[index] = 0;
      }
    }
  }

  return { width: bitmap.width, height: bitmap.height, data: result };
}

export function traceBitmapToImageData(bitmap: TraceBitmap): TraceImageData {
  const rgba = new Uint8ClampedArray(bitmap.width * bitmap.height * 4);
  for (let i = 0; i < bitmap.data.length; i++) {
    const value = bitmap.data[i] === 1 ? 0 : 255;
    rgba[i * 4] = value;
    rgba[i * 4 + 1] = value;
    rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = 255;
  }
  return { width: bitmap.width, height: bitmap.height, data: rgba };
}

export function grayscaleToTraceImageData(
  grayscaleData: Uint8Array,
  width: number,
  height: number,
  options: TraceBitmapOptions,
): TraceImageData {
  return traceBitmapToImageData(grayscaleToTraceBitmap(grayscaleData, width, height, options));
}
