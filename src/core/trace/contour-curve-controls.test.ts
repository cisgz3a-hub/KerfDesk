import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const SIZE = 128;
const CX = 64.25;
const CY = 63.7;
const COVERAGE_GRID = 8;

function antialiasedRing(outer: number, inner: number): RawImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < COVERAGE_GRID; sy += 1) {
        for (let sx = 0; sx < COVERAGE_GRID; sx += 1) {
          const r = Math.hypot(
            x + (sx + 0.5) / COVERAGE_GRID - CX,
            y + (sy + 0.5) / COVERAGE_GRID - CY,
          );
          if (r <= outer && r >= inner) covered += 1;
        }
      }
      const value = Math.round(255 * (1 - covered / COVERAGE_GRID ** 2));
      data.set([value, value, value, 255], 4 * (y * SIZE + x));
    }
  }
  return { width: SIZE, height: SIZE, data };
}

function radialErrors(loop: Polyline, radius: number): number[] {
  const errors: number[] = [];
  for (let i = 1; i < loop.points.length; i += 1) {
    const a = loop.points[i - 1]!;
    const b = loop.points[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      const r = Math.hypot(a.x + (b.x - a.x) * t - CX, a.y + (b.y - a.y) * t - CY);
      errors.push(Math.abs(r - radius));
    }
  }
  return errors;
}

describe('contour detail constraints preserve curved output', () => {
  for (const [outer, inner] of [
    [42.4, 18.7],
    [17.3, 8.2],
  ] as const) {
    it.each(['Sharp', 'Line Art', 'Smooth'])(
      `keeps both antialiased circle boundaries, radii ${outer}/${inner}, %s`,
      async (preset) => {
        const paths = await traceImageToColoredPaths(
          antialiasedRing(outer, inner),
          TRACE_PRESETS[preset]!,
        );
        const loops = paths.flatMap((path) => path.polylines);
        expect(loops).toHaveLength(2);
        const radii = new Set<number>();
        for (const loop of loops) {
          const point = loop.points[0]!;
          const radius =
            Math.hypot(point.x - CX, point.y - CY) > (outer + inner) / 2 ? outer : inner;
          radii.add(radius);
          expect(loop.closed).toBe(true);
          expect(loop.points.at(-1)).toEqual(point);
          const errors = radialErrors(loop, radius);
          expect(errors.length).toBeGreaterThan(50);
          expect(Math.max(...errors)).toBeLessThan(0.4);
          const sumSq = errors.reduce((sum, error) => sum + error * error, 0);
          expect(Math.sqrt(sumSq / errors.length)).toBeLessThan(0.15);
        }
        expect(radii).toEqual(new Set([inner, outer]));
      },
    );
  }

  it.each([
    [1, 20],
    [20, 1],
  ])(
    'does not widen an ordinary thin bar when protecting teeth (%s × %s)',
    async (width, height) => {
      const data = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
      for (let y = 20; y < 20 + height; y += 1) {
        for (let x = 20; x < 20 + width; x += 1) {
          data.set([0, 0, 0, 255], 4 * (y * SIZE + x));
        }
      }
      const paths = await traceImageToColoredPaths(
        { width: SIZE, height: SIZE, data },
        TRACE_PRESETS.Sharp!,
      );
      const loops = paths.flatMap((path) => path.polylines);
      expect(loops).toHaveLength(1);
      // The existing rounded spline is not pixel-exact. Keep its area within
      // 25% of the 20px² bar; pinning raw terminal samples widened it past 30%.
      expect(Math.abs(signedAreaMm2(loops[0]!.points))).toBeGreaterThan(15);
      expect(Math.abs(signedAreaMm2(loops[0]!.points))).toBeLessThan(25);
    },
  );
});
