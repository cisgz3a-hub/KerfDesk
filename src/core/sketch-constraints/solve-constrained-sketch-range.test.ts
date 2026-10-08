import { describe, expect, it } from 'vitest';
import type { ConstrainedSketch2d } from './constrained-sketch';
import { materializeConstrainedSketch } from './materialize-constrained-sketch';
import { parseConstrainedSketch } from './sketch-validation';
import { solveConstrainedSketch } from './solve-constrained-sketch';
import { summarizeSketchSolve } from './sketch-solve-summary';

function circle(diameter: number): ConstrainedSketch2d {
  return {
    version: 1,
    name: 'Dimensioned circle',
    parameters: [],
    points: [{ id: 'o', x: 0, y: 0 }],
    lines: [],
    circles: [{ id: 'circle', centre: 'o', radiusMm: 2 }],
    profiles: [],
    constraints: [{ id: 'diameter', kind: 'diameter', circleId: 'circle', value: diameter }],
  };
}

describe('solved sketch intent remains supported', () => {
  it.each([NaN, Infinity, -Infinity])('withholds a nonfinite residual %s', (value) => {
    expect(summarizeSketchSolve(circle(4), [0, 0, 2], () => [{ id: 'diameter', value }])).toEqual({
      kind: 'invalid',
      reason: 'The sketch solve contains a nonfinite constraint residual.',
    });
  });

  it('withholds nonfinite coordinates before evaluating them', () => {
    expect(summarizeSketchSolve(circle(4), [NaN, 0, 2], () => [])).toEqual({
      kind: 'invalid',
      reason: 'The sketch solve contains nonfinite coordinates.',
    });
  });

  it('withholds nonfinite derivatives even if the current residual is finite', () => {
    expect(
      summarizeSketchSolve(circle(4), [0, 0, 2], (values) => [
        { id: 'diameter', value: values[0] === 0 ? 0 : Infinity },
      ]),
    ).toEqual({ kind: 'invalid', reason: 'The sketch solve contains a nonfinite derivative.' });
  });

  it('withholds replacement geometry if the solved radius cannot reopen', () => {
    const input = circle(300000);
    expect(parseConstrainedSketch(input).kind).toBe('ok');
    const built = materializeConstrainedSketch(input, '#000000');
    expect(built.result).toEqual({
      kind: 'invalid',
      reason: 'The solved sketch leaves the supported coordinate or radius range.',
    });
    expect(built.paths).toBeUndefined();
    expect(input.circles[0]?.radiusMm).toBe(2);
  });

  it('retains the existing maximum supported radius through another solve', () => {
    const result = solveConstrainedSketch(circle(200000));
    expect(result.kind).toBe('solved');
    if (result.kind !== 'solved') throw new Error(result.reason);
    expect(result.sketch.circles[0]?.radiusMm).toBeCloseTo(100000, 5);
    expect(parseConstrainedSketch(result.sketch).kind).toBe('ok');
    const reopened = solveConstrainedSketch(JSON.parse(JSON.stringify(result.sketch)));
    expect(reopened).toMatchObject({
      kind: 'solved',
      status: 'under-constrained',
      degreesOfFreedom: 2,
    });
  });

  it('rejects a dimension beyond the supported radius instead of truncating its geometry', () => {
    expect(solveConstrainedSketch(circle(200000.001)).kind).toBe('invalid');
  });

  it('retains named contradictory residuals even if the least-squares radius is unsupported', () => {
    const input = circle(300000);
    const built = materializeConstrainedSketch(
      {
        ...input,
        constraints: [
          ...input.constraints,
          { id: 'other-diameter', kind: 'diameter', circleId: 'circle', value: 400000 },
        ],
      },
      '#000000',
    );
    expect(built.result).toMatchObject({ kind: 'solved', status: 'over-constrained' });
    if (built.result.kind !== 'solved') throw new Error(built.result.reason);
    expect(built.result.conflicts.map((conflict) => conflict.constraintId)).toEqual([
      'diameter',
      'other-diameter',
    ]);
    expect(built.paths).toBeUndefined();
  });
});
