import type { Bounds, ColoredPath } from '../scene';
import type { RawImageData } from './trace-image';

export type TraceBoundary = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export function normalizeTraceBoundary(
  boundary: TraceBoundary | null | undefined,
  imageWidth: number,
  imageHeight: number,
): TraceBoundary | null {
  if (boundary == null || imageWidth <= 0 || imageHeight <= 0) return null;
  const x0 = clamp(Math.round(boundary.x), 0, imageWidth);
  const y0 = clamp(Math.round(boundary.y), 0, imageHeight);
  const x1 = clamp(Math.round(boundary.x + boundary.width), 0, imageWidth);
  const y1 = clamp(Math.round(boundary.y + boundary.height), 0, imageHeight);
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

export function cropRawImageData(image: RawImageData, boundary: TraceBoundary): RawImageData {
  const normalized = normalizeTraceBoundary(boundary, image.width, image.height);
  if (normalized === null) return image;
  const data = new Uint8ClampedArray(normalized.width * normalized.height * 4);
  for (let row = 0; row < normalized.height; row += 1) {
    const sourceStart = ((normalized.y + row) * image.width + normalized.x) * 4;
    const sourceEnd = sourceStart + normalized.width * 4;
    const targetStart = row * normalized.width * 4;
    data.set(image.data.slice(sourceStart, sourceEnd), targetStart);
  }
  return { width: normalized.width, height: normalized.height, data };
}

export function offsetColoredPaths(
  paths: ReadonlyArray<ColoredPath>,
  offsetX: number,
  offsetY: number,
): ColoredPath[] {
  return paths.map((path) => ({
    ...path,
    polylines: path.polylines.map((polyline) => ({
      ...polyline,
      points: polyline.points.map((point) => ({
        x: point.x + offsetX,
        y: point.y + offsetY,
      })),
    })),
  }));
}

export function offsetBounds(bounds: Bounds, offsetX: number, offsetY: number): Bounds {
  return {
    minX: bounds.minX + offsetX,
    minY: bounds.minY + offsetY,
    maxX: bounds.maxX + offsetX,
    maxY: bounds.maxY + offsetY,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
