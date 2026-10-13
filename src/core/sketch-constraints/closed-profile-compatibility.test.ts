import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { polylineToCurveSubpath } from '../scene/curve-path';
import type { ConstrainedSketch2d } from './constrained-sketch';
import {
  materializeConstrainedSketch,
  sketchGeometryMatches,
} from './materialize-constrained-sketch';

describe('sketch closure compatibility', () => {
  it.each([
    { name: 'exact seam', gap: 0, closed: true, points: 5 },
    { name: 'seam within closure tolerance', gap: 0.00005, closed: true, points: 5 },
    { name: 'seam at closure tolerance', gap: 0.0001, closed: true, points: 6 },
    { name: 'seam beyond closure tolerance', gap: 0.0002, closed: true, points: 6 },
    { name: 'open profile within closure tolerance', gap: 0.00005, closed: false, points: 5 },
    { name: 'open profile beyond closure tolerance', gap: 0.0002, closed: false, points: 5 },
  ])('retains fresh and legacy machining bindings for $name', ({ gap, closed, points }) => {
    const sketch: ConstrainedSketch2d = {
      version: 1,
      name: 'Near seam',
      parameters: [],
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 0 },
        { id: 'c', x: 10, y: 10 },
        { id: 'd', x: 0, y: 10 },
        { id: 'e', x: gap, y: 0 },
      ],
      lines: [],
      circles: [],
      profiles: [{ id: 'outline', pointIds: ['a', 'b', 'c', 'd', 'e'], closed }],
      constraints: [],
    };
    const current = materializedSketch(sketch);
    expect(current.paths[0]?.polylines[0]?.points).toHaveLength(points);
    expect(current.paths[0]?.curves?.[0]?.segments).toHaveLength(points - 1);
    // Old sketches carried only the authored vertices, even for a closed profile.
    const legacyPolyline = {
      closed,
      points: current.constrainedSketch.points.map(({ x, y }) => ({ x, y })),
    };
    const legacy: ImportedSvg = {
      ...current,
      paths: current.paths.map((path) => ({
        ...path,
        polylines: [legacyPolyline],
        curves: [polylineToCurveSubpath(legacyPolyline)],
      })),
    };
    for (const saved of [current, legacy]) {
      expectRetainedBindings(current, saved);
    }
  });
});

function materializedSketch(
  sketch: ConstrainedSketch2d,
): ImportedSvg & { readonly constrainedSketch: ConstrainedSketch2d } {
  const built = materializeConstrainedSketch(sketch, '#000000');
  if (built.result.kind !== 'solved' || built.paths === undefined || built.bounds === undefined)
    throw new Error('Missing sketch geometry');
  return {
    kind: 'imported-svg',
    id: 'near-seam',
    source: 'Near seam',
    transform: IDENTITY_TRANSFORM,
    paths: built.paths.map((path) => ({ ...path, operationIds: ['profile-cut'] })),
    bounds: built.bounds,
    constrainedSketch: built.result.sketch,
  };
}

function expectRetainedBindings(
  current: ImportedSvg & { readonly constrainedSketch: ConstrainedSketch2d },
  saved: ImportedSvg,
): void {
  expect(sketchGeometryMatches(saved)).toBe(true);
  const regenerated = materializeConstrainedSketch(current.constrainedSketch, '#000000', saved);
  expect(regenerated.result.kind).toBe('solved');
  expect(regenerated.paths?.map((path) => path.operationIds)).toEqual([['profile-cut']]);
  expect(regenerated.paths?.[0]?.curves).toEqual(current.paths[0]?.curves);
  expect(regenerated.paths?.[0]?.polylines).toEqual(current.paths[0]?.polylines);
}
