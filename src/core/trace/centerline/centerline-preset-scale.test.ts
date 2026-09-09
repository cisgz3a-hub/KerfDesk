import { describe, expect, it } from 'vitest';
import type { Polyline } from '../../scene';
import { DEFAULT_TRACE_OPTIONS, preprocessForTrace, type RawImageData } from '../trace-image';
import { TRACE_PRESETS } from '../trace-presets';
import { traceImageToColoredPaths } from '../trace-to-paths';
import { traceScalePlan } from '../trace-upscale-policy';
import { traceCenterlineStrokePaths } from './trace-centerline';

const CENTERLINE = TRACE_PRESETS['Centerline']!;

function whiteImage(): RawImageData {
  return { width: 128, height: 128, data: new Uint8ClampedArray(128 * 128 * 4).fill(255) };
}

function inkRect(image: RawImageData, x: number, y: number, width: number, height: number): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = (row * image.width + column) * 4;
      image.data[offset] = 0;
      image.data[offset + 1] = 0;
      image.data[offset + 2] = 0;
    }
  }
}

function addBroadContext(image: RawImageData): void {
  inkRect(image, 18, 15, 92, 20);
}

function lowerPaths(paths: ReturnType<typeof traceCenterlineStrokePaths>): Polyline[] {
  return paths
    .flatMap((path) => path.polylines)
    .filter((path) => path.points.every((point) => point.y > 50));
}

function lowerInkPixels(image: RawImageData): number {
  let ink = 0;
  for (let i = 50 * image.width * 4; i < image.data.length; i += 4) {
    if ((image.data[i] ?? 255) < 128) ink += 1;
  }
  return ink;
}

function brokenStroke(blankColumns: number): RawImageData {
  const image = whiteImage();
  inkRect(image, 18, 64, 42, 1);
  inkRect(image, 60 + blankColumns, 64, 50 - blankColumns, 1);
  return image;
}

describe('Centerline preset connectivity', () => {
  it('retains a diagonal after unrelated broad ink changes tracing to native resolution', async () => {
    const image = whiteImage();
    for (let i = 0; i < 60; i += 1) inkRect(image, 20 + i, 64 + i, 1, 1);
    expect(traceScalePlan(image, CENTERLINE)).toEqual({ kind: 'upscale', factor: 2 });
    expect(lowerPaths(await traceImageToColoredPaths(image, CENTERLINE))).toHaveLength(1);

    addBroadContext(image);
    expect(traceScalePlan(image, CENTERLINE)).toEqual({ kind: 'native' });
    expect(lowerInkPixels(preprocessForTrace(image, CENTERLINE))).toBe(60);
    const retained = lowerPaths(await traceImageToColoredPaths(image, CENTERLINE));
    expect(retained).toHaveLength(1);
    const points = retained.flatMap((path) => path.points);
    expect(Math.min(...points.map((point) => point.x))).toBeLessThan(21);
    expect(Math.max(...points.map((point) => point.x))).toBeGreaterThan(79);
    expect(Math.max(...points.map((point) => Math.abs(point.y - point.x - 44)))).toBeLessThan(0.5);
  });

  it('uses stroke connectivity when called directly without a trace mode', () => {
    const image = whiteImage();
    addBroadContext(image);
    for (let i = 0; i < 12; i += 1) inkRect(image, 20 + i, 64 + i, 1, 1);
    const traced = traceCenterlineStrokePaths(image, {
      ...DEFAULT_TRACE_OPTIONS,
      useOtsuThreshold: true,
      despeckleMinPixels: 12,
    });
    expect(lowerPaths(traced)).toHaveLength(1);
  });

  it('still removes small detached components and retains the contour connectivity convention', () => {
    const image = whiteImage();
    addBroadContext(image);
    for (let i = 0; i < 12; i += 1) inkRect(image, 20 + i, 64 + i, 1, 1);
    for (let i = 0; i < 11; i += 1) inkRect(image, 70 + i, 90 + i, 1, 1);
    inkRect(image, 100, 70, 1, 1);

    // The 12-pixel diagonal meets the area threshold; the 11-pixel diagonal
    // and lone speck remain noise. Filled contours keep four-connectivity.
    expect(lowerInkPixels(preprocessForTrace(image, CENTERLINE))).toBe(12);
    expect(lowerInkPixels(preprocessForTrace(image, TRACE_PRESETS['Line Art']!))).toBe(0);
  });
});

describe('Centerline join distance in source pixels', () => {
  it('joins the same interrupted stroke at automatic 2x and native scales', async () => {
    const image = brokenStroke(1);
    expect(traceScalePlan(image, CENTERLINE)).toEqual({ kind: 'upscale', factor: 2 });
    expect(lowerPaths(await traceImageToColoredPaths(image, CENTERLINE))).toHaveLength(1);

    addBroadContext(image);
    expect(traceScalePlan(image, CENTERLINE)).toEqual({ kind: 'native' });
    expect(lowerPaths(await traceImageToColoredPaths(image, CENTERLINE))).toHaveLength(1);
  });

  it.each([false, true])(
    'preserves deliberate gaps with broad context=%s',
    async (broadContext) => {
      const image = brokenStroke(6);
      if (broadContext) addBroadContext(image);
      expect(lowerPaths(await traceImageToColoredPaths(image, CENTERLINE))).toHaveLength(2);

      const close = brokenStroke(1);
      if (broadContext) addBroadContext(close);
      expect(
        lowerPaths(
          await traceImageToColoredPaths(close, { ...CENTERLINE, centerlineJoinGapPx: 0 }),
        ),
      ).toHaveLength(2);
    },
  );

  it.each([false, true])(
    'keeps nearby parallel strokes separate with broad context=%s',
    async (broadContext) => {
      const image = whiteImage();
      inkRect(image, 20, 61, 40, 1);
      inkRect(image, 20, 63, 40, 1);
      if (broadContext) addBroadContext(image);
      expect(lowerPaths(await traceImageToColoredPaths(image, CENTERLINE))).toHaveLength(2);
    },
  );

  it.each([
    [1.9, 2],
    [2, 2],
    [2.1, 1],
  ])('keeps strict threshold behaviour for source gap limit %s', (sourceGap, expectedPaths) => {
    // The two raw chain endpoints are four working pixels apart. On a 2x
    // grid this is a two-source-pixel gap, including the exact boundary.
    const workingImage = brokenStroke(3);
    const options = { ...CENTERLINE, despeckleMinPixels: 0, fillPinholeCracks: false };
    const sourceUnits = traceCenterlineStrokePaths(workingImage, {
      ...options,
      pixelScale: 2,
      centerlineJoinGapPx: sourceGap,
    });
    const workingUnits = traceCenterlineStrokePaths(workingImage, {
      ...options,
      centerlineJoinGapPx: sourceGap * 2,
    });
    expect(lowerPaths(sourceUnits)).toHaveLength(expectedPaths);
    expect(sourceUnits).toEqual(workingUnits);
  });
});
