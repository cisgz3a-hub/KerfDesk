import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type Polyline,
  type Vec2,
} from '../../scene/scene-object';
import { objectOptimizer, optimizeObjectPaths } from './optimize-object';
import {
  DEFAULT_SHAPE_OPTIMIZE_OPTIONS,
  type ShapeOptimizeOptions,
} from './shape-optimize-options';

function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

function noisyCircle(radius: number, count: number, seed = 1): Vec2[] {
  const random = noise(seed);
  return Array.from({ length: count }, (_, k) => {
    const angle = (2 * Math.PI * k) / count;
    const r = radius + 0.06 * random();
    return { x: 20 + r * Math.cos(angle), y: 20 + r * Math.sin(angle) };
  });
}

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

function artwork(paths: ReadonlyArray<ColoredPath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'a',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

const options = (patch: Partial<ShapeOptimizeOptions> = {}): ShapeOptimizeOptions => ({
  ...DEFAULT_SHAPE_OPTIMIZE_OPTIONS,
  ...patch,
});

describe('optimizeObjectPaths', () => {
  it('keeps plain polylines plain when the result is straight lines only', () => {
    const circle: Polyline = { closed: true, points: noisyCircle(10, 500) };
    const object = artwork([{ color: '#000000', polylines: [circle, SQUARE] }]);

    const result = optimizeObjectPaths(object, options({ fit: false }));

    const path = result.paths[0];
    expect(path?.curves).toBeUndefined();
    expect(path?.polylines[0]?.closed).toBe(true);
    const points = path?.polylines[0]?.points ?? [];
    expect(points[0]).not.toEqual(points.at(-1));
    // The square has nothing to smooth and stays the very same polyline.
    expect(path?.polylines[1]).toBe(SQUARE);
    expect(result.stats).toMatchObject({ sourcePoints: 504, contours: 2, changedContours: 1 });
  });

  it('gives the whole path paired curves once any contour gains arcs or curves', () => {
    const circle: Polyline = { closed: true, points: noisyCircle(10, 500) };
    const object = artwork([{ color: '#ff0000', polylines: [SQUARE, circle] }]);

    const result = optimizeObjectPaths(object, options());

    const [path] = result.paths;
    if (path === undefined) throw new Error('path missing');
    const [squareCurve, circleCurve] = path.curves ?? [];
    expect(path.color).toBe('#ff0000');
    expect(path.curves).toHaveLength(2);
    expect(path.polylines[0]).toBe(SQUARE);
    expect(squareCurve?.segments.every((segment) => segment.kind === 'line')).toBe(true);
    expect(circleCurve?.segments.some((segment) => segment.kind !== 'line')).toBe(true);
    expect(circleCurve?.closed).toBe(true);
  });

  it('leaves a path alone when its curves do not pair with its polylines', () => {
    const circle: Polyline = { closed: true, points: noisyCircle(10, 500) };
    const unpaired: ColoredPath = {
      color: '#000000',
      polylines: [circle, SQUARE],
      curves: [
        {
          start: { x: 0, y: 0 },
          closed: false,
          segments: [{ kind: 'line', to: { x: 1, y: 0 } }],
        },
      ],
    };
    const object = artwork([unpaired]);

    const result = optimizeObjectPaths(object, options());

    expect(result.paths).toBe(object.paths);
    expect(result.stats.contours).toBe(0);
  });

  it('smooths an open contour whose ends meet as the closed outline it draws', () => {
    const points = noisyCircle(10, 500);
    const drawnShut: Polyline = { closed: false, points: [...points, points[0] as Vec2] };
    const object = artwork([{ color: '#000000', polylines: [drawnShut] }]);

    const result = optimizeObjectPaths(object, options());

    const curve = result.paths[0]?.curves?.[0];
    expect(curve?.closed).toBe(false);
    expect(curve?.segments.at(-1)?.to).toEqual(curve?.start);
    // No corner is left at the seam, so the circle takes a handful of curves.
    expect(curve?.segments.length).toBeLessThan(8);
  });

  it('works one contour per step and reports how far it has got', () => {
    const object = artwork([
      {
        color: '#000000',
        polylines: [
          { closed: true, points: noisyCircle(10, 300, 1) },
          { closed: true, points: noisyCircle(5, 100, 2) },
        ],
      },
    ]);
    const optimizer = objectOptimizer(object, options());

    // Progress counts source segments: 299 and 99 for the two rings.
    expect(optimizer.progress()).toEqual({ done: 0, total: 398 });
    expect(optimizer.step()).toBe(true);
    expect(optimizer.progress()).toEqual({ done: 299, total: 398 });
    expect(optimizer.step()).toBe(false);
    expect(optimizer.step()).toBe(false);
    expect(optimizer.result().stats.changedContours).toBe(2);
  });
});
