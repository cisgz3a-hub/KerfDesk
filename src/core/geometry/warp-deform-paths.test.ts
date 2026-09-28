// Applying Warp and Deform maps to artwork paths (LBG-T06): flattening,
// adaptive splitting within tolerance, closed contours and object space.
import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath } from '../scene/curve-path';
import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type Transform,
  type Vec2,
} from '../scene/scene-object';
import { applyTransform } from '../scene/transform';
import {
  initialWarpDeformHandles,
  warpDeformMap,
  warpDeformStretch,
  type PointMap,
} from './warp-deform-map';
import {
  distanceToSegment,
  WARP_DEFORM_TOLERANCE_MM,
  warpObjectPaths,
  warpWorldPoints,
} from './warp-deform-paths';

const BOX: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

function bentDeform(): PointMap {
  const handles = initialWarpDeformHandles('deform', BOX).map((handle, index) => {
    if (index === 5) return { x: handle.x + 25, y: handle.y + 40 };
    if (index === 10) return { x: handle.x - 30, y: handle.y - 20 };
    return handle;
  });
  return warpDeformMap('deform', BOX, handles);
}

function perspectiveWarp(): PointMap {
  return warpDeformMap('warp', BOX, [
    { x: 10, y: 0 },
    { x: 90, y: 10 },
    { x: 130, y: 110 },
    { x: -20, y: 95 },
  ]);
}

function distanceToPolyline(point: Vec2, points: ReadonlyArray<Vec2>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(
      best,
      distanceToSegment(point, points[index - 1] as Vec2, points[index] as Vec2),
    );
  }
  return best;
}

// The largest distance from the truly mapped curve, sampled densely, to the result.
function worstError(
  truePoints: ReadonlyArray<Vec2>,
  map: PointMap,
  result: ReadonlyArray<Vec2>,
): number {
  return Math.max(...truePoints.map((point) => distanceToPolyline(map.apply(point), result)));
}

function densePointsOnLine(a: Vec2, b: Vec2, count = 2000): ReadonlyArray<Vec2> {
  return Array.from({ length: count + 1 }, (_, index) => ({
    x: a.x + ((b.x - a.x) * index) / count,
    y: a.y + ((b.y - a.y) * index) / count,
  }));
}

// A circle of radius 30 about (50, 50) as four cubic quarter arcs.
const CIRCLE: CurveSubpath = (() => {
  const k = 0.5522847498 * 30;
  return {
    start: { x: 80, y: 50 },
    closed: true,
    segments: [
      {
        kind: 'cubic',
        control1: { x: 80, y: 50 + k },
        control2: { x: 50 + k, y: 80 },
        to: { x: 50, y: 80 },
      },
      {
        kind: 'cubic',
        control1: { x: 50 - k, y: 80 },
        control2: { x: 20, y: 50 + k },
        to: { x: 20, y: 50 },
      },
      {
        kind: 'cubic',
        control1: { x: 20, y: 50 - k },
        control2: { x: 50 - k, y: 20 },
        to: { x: 50, y: 20 },
      },
      {
        kind: 'cubic',
        control1: { x: 50 + k, y: 20 },
        control2: { x: 80, y: 50 - k },
        to: { x: 80, y: 50 },
      },
    ],
  };
})();

describe('warpWorldPoints', () => {
  it('adds no points under identity handles', () => {
    const map = warpDeformMap('deform', BOX, initialWarpDeformHandles('deform', BOX));
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 30 },
      { x: 40, y: 100 },
    ];
    const result = warpWorldPoints(points, false, map);
    expect(result).toHaveLength(3);
    result.forEach((point, index) => {
      expect(point.x).toBeCloseTo((points[index] as Vec2).x, 9);
      expect(point.y).toBeCloseTo((points[index] as Vec2).y, 9);
    });
  });

  it('never splits a straight piece under a projective Warp', () => {
    const result = warpWorldPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      false,
      perspectiveWarp(),
    );
    expect(result).toHaveLength(2);
  });

  it('bends a long straight line under Deform to within tolerance of the true bent line', () => {
    const map = bentDeform();
    const a = { x: 0, y: 10 };
    const b = { x: 100, y: 90 };
    const result = warpWorldPoints([a, b], false, map);
    expect(result.length).toBeGreaterThan(5);
    expect(result.length).toBeLessThan(200);
    expect(worstError(densePointsOnLine(a, b), map, result)).toBeLessThanOrEqual(
      WARP_DEFORM_TOLERANCE_MM,
    );
  });

  it('closes a closed contour through its bent closing piece, ending on its first point', () => {
    const map = bentDeform();
    const square = [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
    ];
    const result = warpWorldPoints(square, true, map);
    expect(result.at(-1)).toEqual(result[0]);
    // The closing side (10,90) -> (10,10) is bent too, not a straight chord.
    const closing = densePointsOnLine({ x: 10, y: 90 }, { x: 10, y: 10 });
    expect(worstError(closing, map, result)).toBeLessThanOrEqual(WARP_DEFORM_TOLERANCE_MM);
  });

  it('keeps an already repeated closing point single', () => {
    const result = warpWorldPoints(
      [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 50, y: 80 },
        { x: 10, y: 10 },
      ],
      true,
      perspectiveWarp(),
    );
    expect(result).toHaveLength(4);
    expect(result[3]).toBe(result[0]);
  });
});

describe('warpObjectPaths', () => {
  const circlePath: ColoredPath = {
    color: '#ff0000',
    operationIds: ['cut'],
    fillRule: 'evenodd',
    polylines: [{ closed: true, points: [{ x: 80, y: 50 }] }],
    curves: [CIRCLE],
  };

  it.each([
    ['Deform', bentDeform],
    ['Warp', perspectiveWarp],
  ] as const)('keeps a %s of a circle within 0.05 mm of the truly warped circle', (_, build) => {
    const map = build();
    const result = warpObjectPaths(
      [circlePath],
      IDENTITY_TRANSFORM,
      map,
      warpDeformStretch(map, BOX),
    );
    const polyline = result.paths[0]?.polylines[0];
    if (polyline === undefined) throw new Error('missing polyline');
    const truth = flattenCurveSubpath(CIRCLE, { toleranceMm: 0.0005 });
    if (truth.kind !== 'ok') throw new Error('flatten failed');
    expect(worstError(truth.polyline.points, map, polyline.points)).toBeLessThanOrEqual(
      WARP_DEFORM_TOLERANCE_MM,
    );
    expect(polyline.closed).toBe(true);
    expect(polyline.points.at(-1)).toEqual(polyline.points[0]);
    expect(polyline.points.length).toBeLessThan(2000);
  });

  it('drops the exact curves, keeps the path fields and reports the flattening', () => {
    const result = warpObjectPaths([circlePath], IDENTITY_TRANSFORM, bentDeform(), 3);
    const path = result.paths[0];
    expect(path?.curves).toBeUndefined();
    expect(path).toMatchObject({ color: '#ff0000', operationIds: ['cut'], fillRule: 'evenodd' });
    expect(result.curvesFlattened).toBe(true);
    expect(result.transform).toBe(IDENTITY_TRANSFORM);
  });

  it('does not report flattening for paths that were already straight lines', () => {
    const path: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 50 },
          ],
        },
      ],
    };
    expect(warpObjectPaths([path], IDENTITY_TRANSFORM, bentDeform(), 3).curvesFlattened).toBe(
      false,
    );
  });

  it('warps in world space and keeps the result in the object space under its transform', () => {
    const transform: Transform = {
      x: 40,
      y: 10,
      scaleX: 2,
      scaleY: 0.5,
      rotationDeg: 30,
      mirrorX: true,
      mirrorY: false,
    };
    const local = [
      { x: -5, y: 20 },
      { x: -15, y: 60 },
    ];
    const path: ColoredPath = { color: '#000000', polylines: [{ closed: false, points: local }] };
    const map = perspectiveWarp();
    const result = warpObjectPaths([path], transform, map, 2);
    expect(result.transform).toBe(transform);
    const points = result.paths[0]?.polylines[0]?.points ?? [];
    expect(points).toHaveLength(2);
    points.forEach((point, index) => {
      const expected = map.apply(applyTransform(local[index] as Vec2, transform));
      const actual = applyTransform(point, transform);
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
    });
  });

  it('returns world points under the identity transform when asked', () => {
    const path: ColoredPath = {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      ],
    };
    const transform = { ...IDENTITY_TRANSFORM, x: 10, y: 20 };
    const identity = warpDeformMap('warp', BOX, initialWarpDeformHandles('warp', BOX));
    const result = warpObjectPaths([path], transform, identity, 1, 'world');
    expect(result.transform).toBe(IDENTITY_TRANSFORM);
    expect(result.paths[0]?.polylines[0]?.points[0]?.x).toBeCloseTo(11, 9);
    expect(result.paths[0]?.polylines[0]?.points[0]?.y).toBeCloseTo(22, 9);
  });
});
