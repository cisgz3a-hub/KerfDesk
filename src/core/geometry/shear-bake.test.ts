import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type CurveSubpath, type Transform } from '../scene';
import { applyAffine } from '../vector-export/affine-curves';
import { bakeCurves, localBakeMatrix, worldShear } from './shear-bake';
import { contourSegments, segmentPoint, segmentStart } from './trim-curve-split';

const ARC_SQUARE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    {
      kind: 'elliptical-arc',
      radiusX: 5,
      radiusY: 5,
      rotationDeg: 0,
      largeArc: false,
      sweep: true,
      to: { x: 10, y: 10 },
    },
    { kind: 'cubic', control1: { x: 7, y: 12 }, control2: { x: 3, y: 12 }, to: { x: 0, y: 10 } },
  ],
  closed: true,
};

function samples(curve: CurveSubpath) {
  const contour = contourSegments(curve, true);
  return contour.segments.flatMap((segment, index) =>
    [0.25, 0.5, 0.75].map((t) => segmentPoint(segmentStart(contour, index), segment, t)),
  );
}

describe('shear bake', () => {
  it('places the baked curves exactly where the world shear puts the originals', () => {
    const transform: Transform = {
      x: 40,
      y: 20,
      scaleX: 2,
      scaleY: 1.5,
      rotationDeg: 30,
      mirrorX: true,
      mirrorY: false,
    };
    const world = worldShear({ x: 50, y: 30 }, 20, -10);
    const matrix = localBakeMatrix(transform, world);
    if (matrix === null) throw new Error('expected an invertible transform');
    const [baked] = bakeCurves([ARC_SQUARE], matrix);
    if (baked === undefined) throw new Error('expected a curve');
    const before = samples(ARC_SQUARE).map((p) => applyAffine(world, applyTransform(p, transform)));
    const after = samples(baked).map((p) => applyTransform(p, transform));
    after.forEach((point, index) => {
      // The arc's image is rebuilt from its singular values: exact to rounding.
      expect(point.x).toBeCloseTo(before[index]?.x ?? NaN, 6);
      expect(point.y).toBeCloseTo(before[index]?.y ?? NaN, 6);
    });
    expect(Object.getOwnPropertySymbols(baked.segments[1] ?? {})).toHaveLength(0);
  });

  it('keeps the shear centre fixed and refuses a collapsed transform', () => {
    const world = worldShear({ x: 5, y: 5 }, 30, 0);
    expect(applyAffine(world, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
    expect(localBakeMatrix({ ...IDENTITY_TRANSFORM, scaleX: 0 }, world)).toBeNull();
  });
});
