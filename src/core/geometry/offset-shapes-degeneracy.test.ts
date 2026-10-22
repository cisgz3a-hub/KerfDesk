import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline } from '../scene';
import { offsetShapes, type OffsetShapesOptions } from './offset-shapes';

const IDS = { inward: 'inward', outward: 'outward' };
const OPTIONS: OffsetShapesOptions = {
  distanceMm: 1,
  direction: 'both',
  cornerStyle: 'round',
  outerShapesOnly: false,
};
function artwork(polyline: Polyline, fillRule: 'evenodd' | 'nonzero' = 'evenodd'): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'source',
    source: 'test.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', fillRule, polylines: [polyline] }],
  };
}
function run(object: ImportedSvg, options = OPTIONS) {
  const result = offsetShapes([object], options, IDS);
  if (result.kind === 'error') throw new Error(result.error.message);
  return result.value;
}
const bowtie: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
    { x: 20, y: 0 },
  ],
};

describe('closed offset degeneracy follows the filled region', () => {
  it.each(['evenodd', 'nonzero'] as const)(
    'keeps the two filled bowtie lobes under %s despite zero signed area',
    (fillRule) => {
      const result = run(artwork(bowtie, fillRule));
      expect(result.inward?.paths.flatMap((path) => path.polylines)).toHaveLength(2);
      expect(result.outward?.paths.flatMap((path) => path.polylines)).toHaveLength(1);
      expect(result.inward?.bounds.minY).toBeCloseTo(1, 3);
      expect(result.inward?.bounds.maxY).toBeCloseTo(19, 3);
      expect(result.outward?.bounds.minY).toBeCloseTo(-1, 3);
      expect(result.outward?.bounds.maxY).toBeCloseTo(21, 3);
    },
  );

  it.each(
    [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ],
    ].map((points) => ({ points })),
  )('outlines collinear closed vertices as their visible stroke: $points', ({ points }) => {
    const open = run(artwork({ closed: false, points })).outward;
    const closed = run(artwork({ closed: true, points })).outward;
    expect(closed).not.toBeNull();
    expect(closed?.bounds).toEqual(open?.bounds);
    expect(run(artwork({ closed: true, points })).inward).toBeNull();
  });

  it('outlines a rotated collinear closed line, whose vertices miss exact collinearity', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    const rotated = (closed: boolean): ImportedSvg => ({
      ...artwork({ closed, points }),
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 30, x: 3.3, y: 7.7 },
    });
    const open = run(rotated(false)).outward!.bounds;
    const closed = run(rotated(true)).outward;
    expect(closed).not.toBeNull();
    for (const side of ['minX', 'maxX', 'minY', 'maxY'] as const) {
      expect(closed!.bounds[side]).toBeCloseTo(open[side], 3);
    }
  });

  it('does not publish an empty offset for a point with no stroke extent', () => {
    const result = offsetShapes(
      [artwork({ closed: false, points: [{ x: 3, y: 3 }] })],
      OPTIONS,
      IDS,
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('empty-result');
  });
});
