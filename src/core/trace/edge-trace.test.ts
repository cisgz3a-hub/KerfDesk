import { describe, expect, it } from 'vitest';
import { traceImageToEdgePaths } from './edge-trace';
import { TRACE_PRESETS, type RawImageData } from './trace-image';

const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection']!;

// A `size`x`size` RGBA image: a filled dark square in [lo, hi) on white.
function filledSquare(size: number, lo: number, hi: number): RawImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      const value = x >= lo && x < hi && y >= lo && y < hi ? 0 : 255;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function lowContrastFixture(): RawImageData {
  const size = 72;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      let value = 220;
      if (x >= 10 && x < 32 && y >= 12 && y < 54) value = 0;
      if (x >= 48 && x < 52 && y >= 12 && y < 54) value = 168;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function noisySquare(): RawImageData {
  const size = 80;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      let value = 245;
      if (x >= 22 && x < 58 && y >= 22 && y < 58) value = 0;
      else if ((x * 17 + y * 31) % 19 === 0) value = 150;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function squareWithSmallDot(): RawImageData {
  const size = 80;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      const inSquare = x >= 18 && x < 54 && y >= 18 && y < 54;
      const inDot = x >= 66 && x < 69 && y >= 66 && y < 69;
      const value = inSquare || inDot ? 0 : 255;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function separatedSquares(): RawImageData {
  const width = 88;
  const height = 56;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const left = x >= 16 && x < 36 && y >= 16 && y < 40;
      const right = x >= 44 && x < 64 && y >= 16 && y < 40;
      const value = left || right ? 0 : 255;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

function pointCount(paths: ReturnType<typeof traceImageToEdgePaths>): number {
  return paths
    .flatMap((path) => path.polylines)
    .reduce((sum, polyline) => sum + polyline.points.length, 0);
}

function polylineCount(paths: ReturnType<typeof traceImageToEdgePaths>): number {
  return paths.flatMap((path) => path.polylines).length;
}

function totalPolylineLength(paths: ReturnType<typeof traceImageToEdgePaths>): number {
  return paths
    .flatMap((path) => path.polylines)
    .reduce((total, polyline) => total + polylineLength(polyline.points), 0);
}

function allPoints(paths: ReturnType<typeof traceImageToEdgePaths>) {
  return paths.flatMap((path) => path.polylines).flatMap((polyline) => polyline.points);
}

function pointsInRect(
  paths: ReturnType<typeof traceImageToEdgePaths>,
  rect: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  },
): number {
  return allPoints(paths).filter(
    (point) =>
      point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY,
  ).length;
}

function polylineLength(points: ReadonlyArray<{ readonly x: number; readonly y: number }>): number {
  let total = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a !== undefined && b !== undefined) total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

describe('traceImageToEdgePaths', () => {
  it("traces a filled square's edges as polylines spanning its boundary", () => {
    const paths = traceImageToEdgePaths(filledSquare(64, 18, 46), EDGE_OPTIONS);
    expect(paths.length).toBeGreaterThan(0);
    const points = paths.flatMap((p) => p.polylines).flatMap((pl) => pl.points);
    expect(points.length).toBeGreaterThan(0);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    // The trace hugs the square boundary at ~18 and ~46, not the interior.
    expect(Math.min(...xs)).toBeLessThan(22);
    expect(Math.max(...xs)).toBeGreaterThan(42);
    expect(Math.min(...ys)).toBeLessThan(22);
    expect(Math.max(...ys)).toBeGreaterThan(42);
  });

  it('returns no paths for a flat image (no edges)', () => {
    expect(traceImageToEdgePaths(filledSquare(32, 1, 0), EDGE_OPTIONS)).toEqual([]);
  });

  it('edge sensitivity changes whether low-contrast detail survives', () => {
    const image = lowContrastFixture();
    const insensitive = traceImageToEdgePaths(image, {
      ...EDGE_OPTIONS,
      edgeLowThresholdRatio: 0.18,
      edgeHighThresholdRatio: 0.42,
    });
    const sensitive = traceImageToEdgePaths(image, {
      ...EDGE_OPTIONS,
      edgeLowThresholdRatio: 0.01,
      edgeHighThresholdRatio: 0.035,
    });

    expect(pointCount(sensitive)).toBeGreaterThan(pointCount(insensitive) + 6);
  });

  it('higher edge blur suppresses texture noise while preserving the large boundary', () => {
    const image = noisySquare();
    const detailed = traceImageToEdgePaths(image, {
      ...EDGE_OPTIONS,
      edgeMedianFilter: false,
      edgeBlurSigma: 0,
      edgeLowThresholdRatio: 0.02,
      edgeHighThresholdRatio: 0.05,
      edgeMinLengthPx: 0,
    });
    const smoothed = traceImageToEdgePaths(image, {
      ...EDGE_OPTIONS,
      edgeMedianFilter: false,
      edgeBlurSigma: 2.4,
      edgeLowThresholdRatio: 0.02,
      edgeHighThresholdRatio: 0.05,
      edgeMinLengthPx: 0,
    });
    expect(totalPolylineLength(smoothed)).toBeLessThan(totalPolylineLength(detailed));
    const points = allPoints(smoothed);
    expect(Math.min(...points.map((point) => point.x))).toBeLessThan(25);
    expect(Math.max(...points.map((point) => point.x))).toBeGreaterThan(55);
    expect(Math.min(...points.map((point) => point.y))).toBeLessThan(25);
    expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(55);
  });

  it('edge minimum line removes short traced specks without removing the main boundary', () => {
    const image = squareWithSmallDot();
    const loose = traceImageToEdgePaths(image, {
      ...EDGE_OPTIONS,
      edgeMinLengthPx: 0,
    });
    const filtered = traceImageToEdgePaths(image, {
      ...EDGE_OPTIONS,
      edgeMinLengthPx: 32,
    });

    expect(polylineCount(filtered)).toBeLessThan(polylineCount(loose));
    expect(pointCount(filtered)).toBeGreaterThan(0);
  });

  it('honors zero edge join gap by not bridging adjacent separate contours', () => {
    const image = separatedSquares();
    const unjoined = traceImageToEdgePaths(image, {
      ...EDGE_OPTIONS,
      edgeJoinGapPx: 0,
      edgeMinLengthPx: 8,
    });

    const gapProbe = { minX: 38, maxX: 42, minY: 20, maxY: 36 };
    const points = allPoints(unjoined);
    expect(pointsInRect(unjoined, gapProbe)).toBe(0);
    expect(Math.min(...points.map((point) => point.x))).toBeLessThan(20);
    expect(Math.max(...points.map((point) => point.x))).toBeGreaterThan(60);
  });
});
