import { describe, expect, it } from 'vitest';
import { MAX_FLATTENED_CURVE_SEGMENTS } from '../scene/curve-path';
import { IDENTITY_TRANSFORM, type ColoredPath, type Vec2 } from '../scene/scene-object';
import { initialWarpDeformHandles, warpDeformMap, warpDeformStretch } from './warp-deform-map';
import { WarpDeformGeometryError, warpObjectPaths, warpWorldPoints } from './warp-deform-paths';

function nearestSegment(point: Vec2, points: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
    best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return best;
}

describe('Warp/Deform enlargement accuracy and bounded failure', () => {
  for (const grid of ['warp', 'deform'] as const) {
    it.each([1000, 10000])(
      `${grid}: enlarges a tiny canonical cubic to 100 mm at %ix without coarse chords`,
      (scale) => {
        const size = 100 / scale;
        const box = { minX: 0, minY: 0, maxX: size, maxY: size };
        const path: ColoredPath = {
          color: '#000000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: size, y: 0 },
              ],
            },
          ],
          curves: [
            {
              start: { x: 0, y: 0 },
              closed: false,
              segments: [
                {
                  kind: 'cubic',
                  control1: { x: 0, y: size },
                  control2: { x: size, y: size },
                  to: { x: size, y: 0 },
                },
              ],
            },
          ],
        };
        const handles = initialWarpDeformHandles(grid, box).map((p) => ({
          x: p.x * scale,
          y: p.y * scale,
        }));
        const map = warpDeformMap(grid, box, handles);
        const result = warpObjectPaths(
          [path],
          IDENTITY_TRANSFORM,
          map,
          warpDeformStretch(map, box),
        );
        const points = result.paths[0]?.polylines[0]?.points ?? [];
        let error = 0;
        for (let i = 0; i <= 4096; i++) {
          const t = i / 4096;
          error = Math.max(
            error,
            nearestSegment({ x: 100 * (3 * t * t - 2 * t * t * t), y: 300 * t * (1 - t) }, points),
          );
        }
        expect(error).toBeLessThanOrEqual(0.05);
        expect(points.length).toBeGreaterThan(10);
        expect(points.length).toBeLessThan(256);
      },
    );
  }

  it('refuses over-budget canonical curves instead of accepting the cached endpoint chord', () => {
    const path: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ],
      curves: [
        {
          start: { x: 0, y: 0 },
          closed: false,
          segments: Array.from({ length: MAX_FLATTENED_CURVE_SEGMENTS + 1 }, (_, i) => ({
            kind: 'line' as const,
            to: { x: i + 1, y: 0 },
          })),
        },
      ],
    };
    const map = {
      apply: (point: Vec2) => point,
      keepsLinesStraight: true,
      featureSizeMm: Infinity,
    };
    expect(() => warpObjectPaths([path], IDENTITY_TRANSFORM, map, 1)).toThrow(
      WarpDeformGeometryError,
    );
  });

  it('stops mapped subdivision at its output budget rather than producing an excessive array', () => {
    const map = {
      apply: ({ x }: Vec2) => ({ x, y: 100 * x * x }),
      keepsLinesStraight: false,
      featureSizeMm: 1,
    };
    expect(() =>
      warpWorldPoints(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        false,
        map,
        0.02,
        2,
      ),
    ).toThrow(WarpDeformGeometryError);
  });

  it('refuses nonfinite stretch instead of falling back to a default coarse tolerance', () => {
    const map = {
      apply: (point: Vec2) => point,
      keepsLinesStraight: true,
      featureSizeMm: Infinity,
    };
    expect(() => warpObjectPaths([], IDENTITY_TRANSFORM, map, Infinity)).toThrow(
      WarpDeformGeometryError,
    );
  });

  it.each([0, 0.25])('refuses a nonfinite mapping at source x=%s', (invalidX) => {
    const map = {
      apply: (point: Vec2) => (point.x === invalidX ? { x: Number.NaN, y: 0 } : point),
      keepsLinesStraight: false,
      featureSizeMm: 1,
    };
    expect(() =>
      warpWorldPoints(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        false,
        map,
      ),
    ).toThrow(WarpDeformGeometryError);
  });

  it('refuses local-coordinate overflow after a finite world-space translation', () => {
    const path: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ],
    };
    const map = {
      apply: (point: Vec2) => ({ x: point.x + 1, y: point.y }),
      keepsLinesStraight: true,
      featureSizeMm: Infinity,
    };
    expect(() =>
      warpObjectPaths([path], { ...IDENTITY_TRANSFORM, scaleX: 1e-320 }, map, 1),
    ).toThrow(WarpDeformGeometryError);
  });
});
