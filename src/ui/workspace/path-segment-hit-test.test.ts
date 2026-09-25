import { describe, expect, it } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Transform,
} from '../../core/scene';
import { hitPathSegment, sampledSubpaths } from './path-segment-hit-test';

const LAYERS = [createLayer({ id: '#000000', color: '#000000' })];

const ARCH: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'cubic', control1: { x: 0, y: 10 }, control2: { x: 10, y: 10 }, to: { x: 10, y: 0 } },
  ],
  closed: false,
};

describe('hitPathSegment', () => {
  it('finds the straight segment under the pointer and the exact parameter along it', () => {
    const object = artwork([legacy([0, 0, 10, 0, 10, 10])], { ...IDENTITY_TRANSFORM, x: 5, y: 3 });

    const hit = hitPathSegment(object, LAYERS, { x: 9, y: 3.5 }, 0.1);

    expect(hit?.ref).toEqual({ objectId: 'art', pathIndex: 0, polylineIndex: 0, segmentIndex: 0 });
    expect(hit?.t).toBeCloseTo(0.4, 6);
    expect(hit?.point.x).toBeCloseTo(9, 6);
    expect(hit?.point.y).toBeCloseTo(3, 6);
    expect(hit?.distanceMm).toBeCloseTo(0.5, 6);
  });

  it('refines the parameter on the exact curve, not on its sampling', () => {
    const object = artwork([curved(ARCH)]);

    const hit = hitPathSegment(object, LAYERS, { x: 5, y: 7.7 }, 0.1);

    expect(hit?.ref.segmentIndex).toBe(0);
    expect(hit?.t).toBeCloseTo(0.5, 6);
    expect(hit?.point.y).toBeCloseTo(7.5, 6);
    expect(hit?.distanceMm).toBeCloseTo(0.2, 6);
  });

  it('respects the on-screen radius at the current zoom', () => {
    const object = artwork([legacy([0, 0, 10, 0])]);

    expect(hitPathSegment(object, LAYERS, { x: 5, y: 0.7 }, 0.1)).toBeNull();
    expect(hitPathSegment(object, LAYERS, { x: 5, y: 0.7 }, 0.2)?.ref.segmentIndex).toBe(0);
  });

  it('numbers the closing edge of a closed outline after its last node', () => {
    const square = legacy([0, 0, 10, 0, 10, 10, 0, 10], true);
    const object = artwork([square]);

    const hit = hitPathSegment(object, LAYERS, { x: 0.2, y: 4 }, 0.1);

    expect(hit?.ref.segmentIndex).toBe(3);
    expect(hit?.t).toBeCloseTo(0.6, 6);
  });

  it('maps the pointer through rotation, scale and mirroring', () => {
    const transform: Transform = {
      ...IDENTITY_TRANSFORM,
      x: 50,
      y: 20,
      scaleX: 2,
      scaleY: 2,
      rotationDeg: 90,
      mirrorX: true,
    };
    const object = artwork([legacy([0, 0, 10, 0])], transform);

    // Local (3, 0) mirrors to (-3, 0), doubles to (-6, 0), turns to (0, -6).
    const hit = hitPathSegment(object, LAYERS, { x: 50.3, y: 14 }, 0.1);

    expect(hit?.t).toBeCloseTo(0.3, 6);
    expect(hit?.point.x).toBeCloseTo(50, 6);
    expect(hit?.point.y).toBeCloseTo(14, 6);
  });

  it('prefers the nearest subpath and ignores paths on hidden layers', () => {
    const hidden: ColoredPath = { ...legacy([0, 1, 10, 1]), color: '#ff0000' };
    const object = artwork([hidden, legacy([0, 0, 10, 0]), legacy([0, 3, 10, 3])]);
    const layers = [
      ...LAYERS,
      { ...createLayer({ id: '#ff0000', color: '#ff0000' }), visible: false },
    ];

    const hit = hitPathSegment(object, layers, { x: 5, y: 1 }, 0.2);

    expect(hit?.ref).toEqual({ objectId: 'art', pathIndex: 1, polylineIndex: 0, segmentIndex: 0 });
  });

  it('reuses the sampling until the subpath itself is replaced', () => {
    const path = curved(ARCH);

    expect(sampledSubpaths(path)[0]).toBe(sampledSubpaths({ ...path })[0]);
    expect(sampledSubpaths(curved({ ...ARCH }))[0]).not.toBe(sampledSubpaths(path)[0]);
  });
});

function artwork(paths: ReadonlyArray<ColoredPath>, transform = IDENTITY_TRANSFORM): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform,
    paths,
  };
}

function legacy(coordinates: ReadonlyArray<number>, closed = false): ColoredPath {
  const points = [];
  for (let index = 0; index + 1 < coordinates.length; index += 2) {
    points.push({ x: coordinates[index] ?? 0, y: coordinates[index + 1] ?? 0 });
  }
  return { color: '#000000', polylines: [{ points, closed }] };
}

function curved(curve: CurveSubpath): ColoredPath {
  return {
    color: '#000000',
    polylines: [{ points: [curve.start, ...curve.segments.map((s) => s.to)], closed: false }],
    curves: [curve],
  };
}
