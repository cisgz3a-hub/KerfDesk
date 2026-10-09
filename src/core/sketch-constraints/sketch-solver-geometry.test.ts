import { describe, expect, it } from 'vitest';
import type { ConstrainedSketch2d } from './constrained-sketch';
import { solveConstrainedSketch } from './solve-constrained-sketch';

function segment(firstX = 0, secondX = 0, y = 0): ConstrainedSketch2d {
  return {
    version: 1,
    name: 'Dimensioned segment',
    parameters: [],
    points: [
      { id: 'a', x: firstX, y },
      { id: 'b', x: secondX, y },
    ],
    lines: [{ id: 'ab', first: 'a', second: 'b' }],
    circles: [],
    profiles: [],
    constraints: [{ id: 'length', kind: 'distance', first: 'a', second: 'b', value: 10 }],
  };
}

describe('geometric sketch derivatives', () => {
  it('separates initially coincident points for a feasible distance', () => {
    const result = solveConstrainedSketch(segment());
    expect(result).toMatchObject({
      kind: 'solved',
      status: 'under-constrained',
      degreesOfFreedom: 3,
    });
    if (result.kind !== 'solved') throw new Error(result.reason);
    const a = result.sketch.points[0]!;
    const b = result.sketch.points[1]!;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10, 5);
    expect(a.x + b.x).toBeCloseTo(0, 8);
    expect(a.y + b.y).toBeCloseTo(0, 8);
  });

  it.each(['horizontal', 'vertical'] as const)(
    'opens a collapsed %s segment with a fixed start',
    (kind) => {
      const initial = segment();
      const result = solveConstrainedSketch({
        ...initial,
        constraints: [
          ...initial.constraints,
          { id: 'x', kind: 'x', pointId: 'a', value: 0 },
          { id: 'y', kind: 'y', pointId: 'a', value: 0 },
          { id: 'axis', kind, lineId: 'ab' },
        ],
      });
      expect(result).toMatchObject({
        kind: 'solved',
        status: 'fully-constrained',
        degreesOfFreedom: 0,
      });
      if (result.kind !== 'solved') throw new Error(result.reason);
      const a = result.sketch.points[0]!;
      const b = result.sketch.points[1]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10, 5);
      expect(kind === 'horizontal' ? b.y : b.x).toBeCloseTo(0, 5);
      expect(a.x).toBeCloseTo(0, 5);
      expect(a.y).toBeCloseTo(0, 5);
    },
  );

  it('keeps the free translation and orientation independent of world coordinates', () => {
    const origin = solveConstrainedSketch(segment(0, 5));
    const translated = solveConstrainedSketch(segment(500000, 500005, 500000));
    expect(origin).toMatchObject({
      kind: 'solved',
      status: 'under-constrained',
      degreesOfFreedom: 3,
    });
    expect(translated).toMatchObject({
      kind: 'solved',
      status: 'under-constrained',
      degreesOfFreedom: 3,
    });
    if (origin.kind !== 'solved' || translated.kind !== 'solved')
      throw new Error('missing solution');
    for (let i = 0; i < 2; i += 1) {
      expect(translated.sketch.points[i]!.x - 500000).toBeCloseTo(origin.sketch.points[i]!.x, 5);
      expect(translated.sketch.points[i]!.y - 500000).toBeCloseTo(origin.sketch.points[i]!.y, 5);
    }
  });
  it('opens an equal collapsed segment against an independently fixed reference', () => {
    const initial = segment();
    const result = solveConstrainedSketch({
      ...initial,
      points: [...initial.points, { id: 'c', x: 20, y: 0 }, { id: 'd', x: 30, y: 0 }],
      lines: [...initial.lines, { id: 'cd', first: 'c', second: 'd' }],
      constraints: [
        { id: 'a-x', kind: 'x', pointId: 'a', value: 0 },
        { id: 'a-y', kind: 'y', pointId: 'a', value: 0 },
        { id: 'c-x', kind: 'x', pointId: 'c', value: 20 },
        { id: 'c-y', kind: 'y', pointId: 'c', value: 0 },
        { id: 'd-x', kind: 'x', pointId: 'd', value: 30 },
        { id: 'd-y', kind: 'y', pointId: 'd', value: 0 },
        { id: 'axis', kind: 'horizontal', lineId: 'ab' },
        { id: 'equal', kind: 'equal', firstLineId: 'ab', secondLineId: 'cd' },
      ],
    });
    expect(result).toMatchObject({
      kind: 'solved',
      status: 'fully-constrained',
      degreesOfFreedom: 0,
    });
    if (result.kind !== 'solved') throw new Error(result.reason);
    expect(result.sketch.points[1]?.x).toBeCloseTo(10, 5);
    expect(result.sketch.points[1]?.y).toBeCloseTo(0, 5);
    expect(result.sketch.points[2]?.x).toBeCloseTo(20, 5);
    expect(result.sketch.points[3]?.x).toBeCloseTo(30, 5);
  });

  it('combines coincident, horizontal and distance relations from a collapsed start', () => {
    const initial = segment();
    const result = solveConstrainedSketch({
      ...initial,
      points: [...initial.points, { id: 'c', x: 0, y: 0 }],
      lines: [{ id: 'bc', first: 'b', second: 'c' }],
      constraints: [
        { id: 'a-x', kind: 'x', pointId: 'a', value: 0 },
        { id: 'a-y', kind: 'y', pointId: 'a', value: 0 },
        { id: 'join', kind: 'coincident', first: 'a', second: 'b' },
        { id: 'axis', kind: 'horizontal', lineId: 'bc' },
        { id: 'length', kind: 'distance', first: 'b', second: 'c', value: 10 },
      ],
    });
    expect(result).toMatchObject({
      kind: 'solved',
      status: 'fully-constrained',
      degreesOfFreedom: 0,
    });
    if (result.kind !== 'solved') throw new Error(result.reason);
    expect(result.sketch.points[1]?.x).toBeCloseTo(0, 5);
    expect(result.sketch.points[1]?.y).toBeCloseTo(0, 5);
    expect(result.sketch.points[2]?.x).toBeCloseTo(10, 5);
    expect(result.sketch.points[2]?.y).toBeCloseTo(0, 5);
  });

  it('retains named conflict residuals for an incompatible coincident distance', () => {
    const initial = segment();
    const result = solveConstrainedSketch({
      ...initial,
      constraints: [
        ...initial.constraints,
        { id: 'join', kind: 'coincident', first: 'a', second: 'b' },
      ],
    });
    expect(result).toMatchObject({ kind: 'solved', status: 'over-constrained' });
    if (result.kind !== 'solved') throw new Error(result.reason);
    expect(result.maximumResidualMm).toBeCloseTo(5, 5);
    expect(result.conflicts.map((conflict) => conflict.constraintId)).toEqual(['length', 'join']);
  });
  it.each([
    [0, 1, 0],
    [3, 1, 0],
    [3, 0.6, 0.8],
  ])(
    'reaches the 3-4-5 intersection from a collinear start %s with rotation (%s, %s)',
    (x, cosine, sine) => {
      const initial = segment();
      const result = solveConstrainedSketch({
        ...initial,
        points: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 6 * cosine!, y: 6 * sine! },
          { id: 'c', x: x! * cosine!, y: x! * sine! },
        ],
        constraints: [
          { id: 'a-x', kind: 'x', pointId: 'a', value: 0 },
          { id: 'a-y', kind: 'y', pointId: 'a', value: 0 },
          { id: 'b-x', kind: 'x', pointId: 'b', value: 6 * cosine! },
          { id: 'b-y', kind: 'y', pointId: 'b', value: 6 * sine! },
          { id: 'ac', kind: 'distance', first: 'a', second: 'c', value: 5 },
          { id: 'bc', kind: 'distance', first: 'b', second: 'c', value: 5 },
        ],
      });
      expect(result).toMatchObject({
        kind: 'solved',
        status: 'fully-constrained',
        degreesOfFreedom: 0,
      });
      if (result.kind !== 'solved') throw new Error(result.reason);
      const apex = result.sketch.points[2]!;
      expect(apex.x * cosine! + apex.y * sine!).toBeCloseTo(3, 5);
      expect(Math.abs(-apex.x * sine! + apex.y * cosine!)).toBeCloseTo(4, 5);
    },
  );
});
