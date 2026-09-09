import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { mergeLightBurnTraceSettings } from '../../ui/trace/trace-options';
import type { RawImageData, TraceOptions } from './trace-image';
import { contourPolylinesFromMask } from './contour-trace';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan } from './trace-upscale-policy';
import { TRACE_PRESETS } from './trace-presets';

function image(size: number): RawImageData {
  return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) };
}

function square(source: RawImageData, x: number, y: number, size: number, value = 0): void {
  for (let row = y; row < y + size; row += 1) {
    for (let col = x; col < x + size; col += 1) {
      const index = 4 * (row * source.width + col);
      source.data.set([value, value, value, 255], index);
    }
  }
}

function validClosed(loop: Polyline): void {
  expect(loop.closed).toBe(true);
  expect(loop.points.at(-1)).toEqual(loop.points[0]);
  expect(new Set(loop.points.map((point) => `${point.x},${point.y}`)).size).toBeGreaterThanOrEqual(
    3,
  );
  expect(loop.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
    true,
  );
  expect(Math.abs(signedAreaMm2(loop.points))).toBeGreaterThan(0);
}

describe('admitted tiny contours', () => {
  it.each([0, 0.2, 2])('retains a prepared counter with Smooth / Optimize %s', async (optimize) => {
    const source = image(192);
    square(source, 100, 100, 60);
    square(source, 18, 18, 18);
    square(source, 24, 24, 3, 255);
    const options = mergeLightBurnTraceSettings(TRACE_PRESETS.Smooth as TraceOptions, {
      ignoreLessThanPixels: 0,
      optimize,
    });
    // The preset's ink cleanup and pinhole fill remain active. This 3x3
    // counter survives them; its loss used to occur in the closed DP tail.
    expect(traceScalePlan(source, options)).toEqual({ kind: 'native' });
    const loops = (await traceImageToColoredPaths(source, options)).flatMap(
      (path) => path.polylines,
    );
    expect(loops).toHaveLength(3);
    loops.forEach(validClosed);
    const holes = loops.filter((loop) => signedAreaMm2(loop.points) < 0);
    expect(holes).toHaveLength(1);
    expect(Math.abs(signedAreaMm2(holes[0]!.points))).toBeGreaterThan(4);
    expect(
      holes[0]!.points.every(
        (point) => point.x > 18 && point.x < 36 && point.y > 18 && point.y < 36,
      ),
    ).toBe(true);
  });

  it.each(['Line Art', 'Smooth', 'Sharp'])(
    '%s keeps the requested small outer regions',
    async (preset) => {
      const source = image(192);
      for (const [x, y, size] of [
        [20, 20, 1],
        [40, 20, 2],
        [60, 20, 3],
        [20, 40, 4],
        [40, 40, 6],
        [100, 100, 60],
      ]) {
        square(source, x!, y!, size!);
      }
      for (const optimize of [0, 0.2, 2]) {
        // Explicit user area choices. This does not change preset preparation.
        const options = mergeLightBurnTraceSettings(TRACE_PRESETS[preset] as TraceOptions, {
          ignoreLessThanPixels: 0,
          despeckleMinPixels: 0,
          optimize,
        });
        const loops = (await traceImageToColoredPaths(source, options)).flatMap(
          (path) => path.polylines,
        );
        expect(loops).toHaveLength(6);
        loops.forEach(validClosed);
        expect(loops.every((loop) => signedAreaMm2(loop.points) > 0)).toBe(true);
      }
    },
  );

  it('preserves the same prepared counter through the actual supersampling route', async () => {
    const source = image(64);
    square(source, 18, 18, 18);
    square(source, 24, 24, 3, 255);
    const options = mergeLightBurnTraceSettings(TRACE_PRESETS.Smooth as TraceOptions, {
      ignoreLessThanPixels: 0,
      optimize: 2,
    });
    expect(traceScalePlan(source, options).kind).toBe('upscale');
    const loops = (await traceImageToColoredPaths(source, options)).flatMap(
      (path) => path.polylines,
    );
    expect(loops).toHaveLength(2);
    loops.forEach(validClosed);
    expect(loops.filter((loop) => signedAreaMm2(loop.points) < 0)).toHaveLength(1);
    expect(
      loops.flatMap((loop) => loop.points).every((point) => point.x < 40 && point.y < 40),
    ).toBe(true);
  });

  it.each([1, 2, 3])(
    'keeps admitted %spx outers and holes, with strict source-area selection',
    (size) => {
      // Isolate the shared mask finisher after preparation. In particular, a
      // one-pixel hole here is not a claim that public pinhole cleanup keeps it.
      for (const scale of [1, 2]) {
        const source = image(48 * scale);
        square(source, 4 * scale, 4 * scale, size * scale);
        square(source, 16 * scale, 16 * scale, 20 * scale);
        square(source, 24 * scale, 24 * scale, size * scale, 255);
        const ink = Uint8Array.from({ length: source.width * source.height }, (_, index) =>
          source.data[4 * index] === 0 ? 1 : 0,
        );
        for (const minimum of [0, size * size - 0.25, size * size, size * size + 0.25]) {
          for (const epsilon of [0.3825, 2.115]) {
            for (const flattenStrength of [0, 1, 3]) {
              const loops = contourPolylinesFromMask(
                { width: source.width, height: source.height, ink },
                {
                  minAreaPx: minimum * scale * scale,
                  epsilonPx: epsilon * scale,
                  flattenStrength,
                  pixelScale: scale,
                },
              );
              const retained = minimum <= size * size;
              expect(loops).toHaveLength(retained ? 3 : 1);
              loops.forEach(validClosed);
              expect(loops.filter((loop) => signedAreaMm2(loop.points) < 0)).toHaveLength(
                retained ? 1 : 0,
              );
            }
          }
        }
      }
    },
  );
});
