import { describe, expect, it } from 'vitest';

import type { RawImageData, TraceOptions } from './trace-image';
import { traceImageToCenterlinePaths } from './centerline-trace';
import type { Vec2 } from '../scene';

const CENTERLINE_OPTIONS: TraceOptions = {
  numberOfColors: 2,
  pathOmit: 0,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: true,
  thresholdLuma: 128,
  traceMode: 'centerline',
};

function whiteImage(width: number, height: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function paintRect(
  image: RawImageData,
  x0: number,
  y0: number,
  width: number,
  height: number,
): RawImageData {
  const data = new Uint8ClampedArray(image.data);
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      const i = (y * image.width + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return { ...image, data };
}

function paintThickLine(
  image: RawImageData,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  radius: number,
): RawImageData {
  const data = new Uint8ClampedArray(image.data);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - start.x) * dx + (py - start.y) * dy) / lenSq));
      const cx = start.x + t * dx;
      const cy = start.y + t * dy;
      if (Math.hypot(px - cx, py - cy) > radius) continue;
      const i = (y * image.width + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return { ...image, data };
}

function longestPolyline(paths: ReturnType<typeof traceImageToCenterlinePaths>) {
  return [...(paths[0]?.polylines ?? [])].sort(
    (a, b) => polylineLength(b.points) - polylineLength(a.points),
  )[0];
}

function polylineLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

describe('traceImageToCenterlinePaths', () => {
  it('turns a thick horizontal stroke into one open centerline', () => {
    const image = paintRect(whiteImage(16, 8), 2, 2, 12, 3);

    const paths = traceImageToCenterlinePaths(image, CENTERLINE_OPTIONS);
    const polylines = paths[0]?.polylines ?? [];
    const longest = [...polylines].sort((a, b) => b.points.length - a.points.length)[0];

    expect(paths).toHaveLength(1);
    expect(paths[0]?.color).toBe('#000000');
    expect(polylines.every((pl) => !pl.closed)).toBe(true);
    expect(polylineLength(longest?.points ?? [])).toBeGreaterThanOrEqual(8);
    const ys = longest?.points.map((p) => p.y) ?? [];
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(0.5);
    expect(ys[0]).toBeCloseTo(3.5, 6);
  });

  it('does not output closed outline contours for a thick plus stroke', () => {
    let image = paintRect(whiteImage(16, 16), 6, 2, 3, 12);
    image = paintRect(image, 2, 6, 12, 3);

    const paths = traceImageToCenterlinePaths(image, CENTERLINE_OPTIONS);
    const polylines = paths[0]?.polylines ?? [];
    const pointCount = polylines.reduce((sum, pl) => sum + pl.points.length, 0);

    expect(polylines.length).toBeGreaterThan(0);
    expect(polylines.every((pl) => !pl.closed)).toBe(true);
    expect(pointCount).toBeLessThan(40);
  });

  it('returns no paths for an all-white image', () => {
    expect(traceImageToCenterlinePaths(whiteImage(8, 8), CENTERLINE_OPTIONS)).toEqual([]);
  });

  it('drops tiny skeleton spurs while keeping the main stroke', () => {
    let image = paintRect(whiteImage(18, 8), 2, 3, 12, 3);
    image = paintRect(image, 15, 3, 2, 1);

    const paths = traceImageToCenterlinePaths(image, CENTERLINE_OPTIONS);
    const polylines = paths[0]?.polylines ?? [];

    expect(polylines).toHaveLength(1);
    expect(polylineLength(polylines[0]?.points ?? [])).toBeGreaterThanOrEqual(8);
  });

  it('collapses a thick straight diagonal into straight centerline geometry', () => {
    const image = paintThickLine(whiteImage(32, 18), { x: 3, y: 13 }, { x: 29, y: 4 }, 2.2);

    const paths = traceImageToCenterlinePaths(image, CENTERLINE_OPTIONS);
    const longest = longestPolyline(paths);

    expect(longest?.points.length).toBeLessThanOrEqual(4);
  });

  it('prunes short pointy protrusion branches from an otherwise straight stroke', () => {
    let image = paintRect(whiteImage(36, 18), 4, 8, 28, 5);
    image = paintRect(image, 17, 4, 3, 4);

    const paths = traceImageToCenterlinePaths(image, CENTERLINE_OPTIONS);
    const polylines = paths[0]?.polylines ?? [];

    expect(polylines).toHaveLength(1);
    expect(longestPolyline(paths)?.points.length).toBeLessThanOrEqual(4);
  });
});
