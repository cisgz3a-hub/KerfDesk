import { describe, expect, it } from 'vitest';
import type { ColoredPath, Polyline } from '../scene';
import { DEFAULT_TRACE_OPTIONS, type RawImageData, type TraceOptions } from './trace-image';
import { traceImageToPhotoPathsSteps } from './photo-trace';
import { runTraceSteps } from './trace-steps';

const options: TraceOptions = { ...DEFAULT_TRACE_OPTIONS, photoDetail: 60 };

function fixture(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

function gray(width: number, height: number, value: number, alpha = 255): RawImageData {
  return fixture(width, height, () => [value, value, value, alpha]);
}

function trace(image: RawImageData, overrides: Partial<TraceOptions> = {}): ColoredPath[] {
  return runTraceSteps(traceImageToPhotoPathsSteps(image, { ...options, ...overrides }));
}

function polygonArea(polyline: Polyline): number {
  let twice = 0;
  for (let i = 0; i < polyline.points.length; i += 1) {
    const a = polyline.points[i]!;
    const b = polyline.points[(i + 1) % polyline.points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

function area(paths: readonly ColoredPath[]): number {
  return paths.flatMap((path) => path.polylines).reduce((sum, line) => sum + polygonArea(line), 0);
}

// Independent scanline measurement of the exported geometry, as fill CAM
// sees it. A light patch must retain a narrow span on ordinary horizontal
// rows, even when its ribbon is thinner than the vertical sample pitch.
function inkWidthAt(paths: readonly ColoredPath[], y: number): number {
  const intersections: number[] = [];
  for (const line of paths.flatMap((path) => path.polylines)) {
    for (let i = 0; i < line.points.length; i += 1) {
      const a = line.points[i]!;
      const b = line.points[(i + 1) % line.points.length]!;
      if (a.y > y === b.y > y) continue;
      intersections.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  intersections.sort((a, b) => a - b);
  let width = 0;
  for (let i = 0; i < intersections.length; i += 2) {
    width += intersections[i + 1]! - intersections[i]!;
  }
  return width;
}

describe('photo shading vectors', () => {
  it.each([0, 32, 64, 128, 192, 224, 254, 255])(
    'preserves the exact filled-area coverage of uniform gray %s',
    (value) => {
      const image = gray(91, 67, value);
      const paths = trace(image);
      const darkness = 1 - value / 255;
      expect(area(paths) / (image.width * image.height)).toBeCloseTo(darkness, 10);
      expect(inkWidthAt(paths, 33.37) / image.width).toBeCloseTo(darkness, 10);
      if (value === 255) expect(paths).toEqual([]);
      else {
        expect(paths).toHaveLength(1);
        expect(paths[0]!.color).toBe('#000000');
        expect(paths[0]!.polylines.every((line) => line.closed)).toBe(true);
        expect(paths[0]!.curves).toBeUndefined();
      }
    },
  );

  it('retains distinct midtones and narrow highlights along a gradient', () => {
    const image = fixture(64, 128, (_, y) => {
      const value = y * 2;
      return [value, value, value, 255];
    });
    const paths = trace(image);
    const coverages = Array.from(
      { length: 126 },
      (_, y) => inkWidthAt(paths, y + 1.5) / image.width,
    );
    expect(new Set(coverages.map((value) => value.toFixed(5))).size).toBe(126);
    for (let y = 0; y < coverages.length; y += 1) {
      expect(coverages[y]).toBeCloseTo(1 - ((y + 1) * 2) / 255, 9);
    }
    expect(coverages.at(-1)).toBeGreaterThan(0);
    expect(area(paths) / (64 * 128)).toBeCloseTo(1 - 127 / 255, 10);
  });

  it('composites partial alpha onto white while ignoring hidden transparent RGB', () => {
    expect(area(trace(gray(45, 39, 0, 128))) / (45 * 39)).toBeCloseTo(128 / 255, 10);
    expect(trace(gray(45, 39, 0, 128))).toEqual(trace(gray(45, 39, 127)));
    const invisible = fixture(45, 39, (x, y) => [x * 5, y * 6, (x + y) * 3, 0]);
    expect(trace(invisible)).toEqual([]);
    expect(trace(invisible, { invert: true, brightness: -100 })).toEqual([]);
  });

  it('uses colour luminance before compositing partial alpha', () => {
    const image = fixture(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 255, 0, 128]));
    expect(area(trace(image))).toBeCloseTo(1 - 0.2126 + ((1 - 0.7152) * 128) / 255, 10);
  });

  it('splits ribbons at completely white gaps', () => {
    const image = fixture(1, 8, (_, y) => {
      const value = y === 2 || y === 3 ? 255 : 128;
      return [value, value, value, 255];
    });
    const paths = trace(image);
    expect(paths[0]!.polylines).toHaveLength(2);
    expect(inkWidthAt(paths, 2.5)).toBe(0);
    expect(inkWidthAt(paths, 3.5)).toBe(0);
    expect(area(paths)).toBeCloseTo((6 * 127) / 255, 10);
    for (const line of paths[0]!.polylines) {
      expect(line.points.every((p) => p.y <= 2) || line.points.every((p) => p.y >= 4)).toBe(true);
    }
  });

  it('area-averages non-integer source cells without aliasing away dark pixels', () => {
    const image = fixture(257, 113, (x, y) => {
      const value = (x * 31 + y * 17) % 256;
      return [value, value, value, 255];
    });
    let expectedArea = 0;
    for (let i = 0; i < image.data.length; i += 4) expectedArea += 1 - image.data[i]! / 255;
    const paths = trace(image, { photoDetail: 0 });
    expect(area(paths)).toBeCloseTo(expectedArea, 7);
    for (const point of paths.flatMap((p) => p.polylines).flatMap((p) => p.points)) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(image.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(image.height);
    }
  });

  it.each([
    [503, 91],
    [91, 503],
    [1, 1],
  ])('fills all source bounds without changing the %s by %s aspect ratio', (width, height) => {
    const paths = trace(gray(width, height, 0));
    const points = paths.flatMap((p) => p.polylines).flatMap((p) => p.points);
    expect(Math.min(...points.map((p) => p.x))).toBe(0);
    expect(Math.min(...points.map((p) => p.y))).toBe(0);
    expect(Math.max(...points.map((p) => p.x))).toBe(width);
    expect(Math.max(...points.map((p) => p.y))).toBe(height);
    expect(area(paths)).toBeCloseTo(width * height, 7);
  });

  it('increases detail within a fixed geometry budget', () => {
    const image = gray(512, 768, 128);
    const low = trace(image, { photoDetail: 0 });
    const high = trace(image, { photoDetail: 100 });
    expect(high[0]!.polylines.length).toBeGreaterThan(low[0]!.polylines.length);
    expect(high[0]!.polylines.length).toBeLessThanOrEqual(320);
    expect(high[0]!.polylines.every((line) => line.points.length === 4)).toBe(true);
    expect(area(low)).toBeCloseTo(area(high), 7);
    expect(trace(gray(100000, 1, 128), { photoDetail: 100 })[0]!.polylines).toHaveLength(320);
    expect(trace(gray(1, 100000, 128), { photoDetail: 100 })[0]!.polylines).toHaveLength(1);
  });

  it('is deterministic and identical through cooperative checkpoints without mutating input', () => {
    const image = fixture(79, 101, (x, y) => [x * 3, y * 2, x + y, 128 + (x % 128)]);
    const original = image.data.slice();
    const expected = trace(image);
    expect(trace(image)).toEqual(expected);
    const steps = traceImageToPhotoPathsSteps(image, options);
    let step = steps.next();
    let checkpoints = 0;
    while (!step.done) {
      checkpoints += 1;
      step = steps.next(true);
    }
    expect(checkpoints).toBeGreaterThan(20);
    expect(step.value).toEqual(expected);
    expect(image.data).toEqual(original);
  });

  it('provides sampling checkpoints even within a very wide source row', () => {
    const steps = traceImageToPhotoPathsSteps(gray(40000, 1, 128), {
      ...options,
      photoDetail: 100,
    });
    let step = steps.next();
    let checkpoints = 0;
    while (!step.done) {
      checkpoints += 1;
      step = steps.next(true);
    }
    expect(checkpoints).toBeGreaterThan(step.value[0]!.polylines.length + 2);
  });

  it('ignores binary cleanup, quantization, and alpha-mask options', () => {
    const image = gray(37, 29, 192, 128);
    expect(
      trace(image, {
        thresholdLuma: 2,
        cutoffLuma: 1,
        useOtsuThreshold: true,
        sketchTrace: true,
        autoSketchTrace: true,
        medianFilter: true,
        despeckleMinPixels: 99999,
        ignoreLessThanPixels: 99999,
        fillPinholeCracks: true,
        traceTransparency: true,
        sourceHasTransparency: true,
        numberOfColors: 2,
        fixedPalette: ['#ffffff', '#000000'],
      }),
    ).toEqual(trace(image));
  });

  it.each([
    [{ brightness: 20 }, 115],
    [{ contrast: 100 }, 0],
    [{ gamma: 2 }, 128],
    [{ invert: true }, 191],
  ] as const)('applies the existing trace tone adjustment %j', (adjustment, adjustedGray) => {
    const image = gray(39, 53, 64);
    expect(area(trace(image, adjustment)) / (39 * 53)).toBeCloseTo(1 - adjustedGray / 255, 10);
  });

  it.each([NaN, Infinity, -Infinity])(
    'normalizes non-finite detail and tone inputs (%s)',
    (bad) => {
      const image = gray(61, 89, 127);
      expect(
        trace(image, { photoDetail: bad, brightness: bad, contrast: bad, gamma: bad }),
      ).toEqual(trace(image));
    },
  );

  it('clamps out-of-range detail and rejects malformed image shapes', () => {
    const image = gray(61, 89, 127);
    expect(trace(image, { photoDetail: -100 })).toEqual(trace(image, { photoDetail: 0 }));
    expect(trace(image, { photoDetail: 1000 })).toEqual(trace(image, { photoDetail: 100 }));
    expect(trace({ ...image, width: 0 })).toEqual([]);
    expect(trace({ ...image, height: NaN })).toEqual([]);
    expect(trace({ ...image, data: new Uint8ClampedArray(4) })).toEqual([]);
  });
});
