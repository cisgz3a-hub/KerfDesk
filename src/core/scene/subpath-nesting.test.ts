import { describe, expect, it } from 'vitest';
import { polylineToCurveSubpath, transformCurveSubpathUniform } from './curve-path';
import type { ColoredPath, CurveSubpath, Polyline } from './scene-object';
import {
  carriedSubpathDepths,
  carriedSubpathParents,
  carrySubpathNesting,
  subsetSubpathNesting,
  subpathGeometryKey,
  withSubpathNesting,
  withoutSubpathNesting,
} from './subpath-nesting';

const square = (x: number, y: number, size: number): Polyline => ({
  closed: true,
  points: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
});

// An outer, its hole, an island in the hole, and a second outer.
const polylines = [square(0, 0, 30), square(5, 5, 20), square(10, 10, 5), square(40, 0, 5)];
const parents = [-1, 0, 1, -1];
const plain: ColoredPath = { color: '#000000', polylines };

describe('carried subpath nesting (ADR-441)', () => {
  it('reads back parents and depths while the geometry is unchanged', () => {
    const nested = withSubpathNesting(plain, parents);
    expect(carriedSubpathParents(nested)).toEqual(parents);
    expect(carriedSubpathDepths(nested)).toEqual([0, 1, 2, 0]);
  });

  it('ignores the forest once any subpath geometry changes', () => {
    const nested = withSubpathNesting(plain, parents);
    const nudged: ColoredPath = {
      ...nested,
      polylines: nested.polylines.map((polyline, index) =>
        index === 2
          ? { ...polyline, points: polyline.points.map((p) => ({ x: p.x + 1e-9, y: p.y })) }
          : polyline,
      ),
    };
    expect(carriedSubpathParents(nudged)).toBeNull();
    const reordered: ColoredPath = { ...nested, polylines: [...polylines].reverse() };
    expect(carriedSubpathParents(reordered)).toBeNull();
    const dropped: ColoredPath = { ...nested, polylines: polylines.slice(0, 3) };
    expect(carriedSubpathParents(dropped)).toBeNull();
  });

  it('refuses malformed forests', () => {
    for (const bad of [
      [-1, 0, 1],
      [-1, 0, 3, -1],
      [-1, 1, 1, -1],
      [-1, 0.5, 1, -1],
      [-2, 0, 1, -1],
    ]) {
      expect(withSubpathNesting(plain, bad).subpathNesting).toBeUndefined();
    }
    const open: ColoredPath = {
      ...plain,
      polylines: [{ ...polylines[0]!, closed: false }, ...polylines.slice(1)],
    };
    expect(withSubpathNesting(open, parents).subpathNesting).toBeUndefined();
    const forged = {
      ...plain,
      subpathNesting: { parents: 'x', geometryKey: 3 },
    } as unknown as ColoredPath;
    expect(carriedSubpathParents(forged)).toBeNull();
  });

  it('keys polylines and the straight-segment curves a save materializes alike', () => {
    const nested = withSubpathNesting(plain, parents);
    const saved: ColoredPath = { ...nested, curves: polylines.map(polylineToCurveSubpath) };
    expect(subpathGeometryKey(saved)).toBe(subpathGeometryKey(plain));
    expect(carriedSubpathParents(saved)).toEqual(parents);
    // A JSON round trip keeps every double, so a loaded project keeps it.
    const loaded = JSON.parse(JSON.stringify(saved)) as ColoredPath;
    expect(carriedSubpathParents(loaded)).toEqual(parents);
  });

  it('carries across a containment-preserving map and drops a stale forest', () => {
    const curves: CurveSubpath[] = polylines.map(polylineToCurveSubpath);
    const nested = withSubpathNesting({ ...plain, curves }, parents);
    const scaled: ColoredPath = {
      ...nested,
      curves: curves.map((curve) => transformCurveSubpathUniform(curve, { scale: 0.5 })),
    };
    expect(carriedSubpathParents(scaled)).toBeNull();
    expect(carriedSubpathParents(carrySubpathNesting(nested, scaled))).toEqual(parents);
    const unnested = carrySubpathNesting(plain, scaled);
    expect(unnested.subpathNesting).toBeUndefined();
    expect(withoutSubpathNesting(nested).subpathNesting).toBeUndefined();
  });

  it('restricts the forest to a subset of subpaths', () => {
    const nested = withSubpathNesting(plain, parents);
    // The outer and the island, without the hole between them.
    const subset: ColoredPath = { ...plain, polylines: [polylines[0]!, polylines[2]!] };
    expect(carriedSubpathParents(subsetSubpathNesting(nested, [0, 2], subset))).toEqual([-1, 0]);
    const tail: ColoredPath = { ...plain, polylines: [polylines[1]!, polylines[2]!] };
    expect(carriedSubpathParents(subsetSubpathNesting(nested, [1, 2], tail))).toEqual([-1, 0]);
    expect(subsetSubpathNesting(plain, [1, 2], tail).subpathNesting).toBeUndefined();
  });
});
