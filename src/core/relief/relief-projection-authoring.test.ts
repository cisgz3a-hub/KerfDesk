import { describe, expect, it } from 'vitest';
import { partialCellCenter } from '../grid';
import type { CncTool, Polyline } from '../scene';
import type { Heightmap } from './heightmap';
import { reliefProjectionPlan } from './relief-projection-plan';
const ball: CncTool = { id: 'ball', name: 'Ball', kind: 'ball-nose', diameterMm: 1 };
function plane(slope = 0): Heightmap {
  const shape = { widthCells: 24, heightCells: 24, widthMm: 4.8, heightMm: 4.8, mmPerCell: 0.2 };
  return {
    ...shape,
    depth: Float32Array.from(
      { length: 576 },
      (_, index) => -3 + slope * partialCellCenter(shape, 'x', index % 24),
    ),
  };
}
const line: Polyline = {
  closed: false,
  points: [
    { x: 1.5, y: 2 },
    { x: 3, y: 2 },
  ],
};

describe('vertical relief vector projection', () => {
  it('tracks an analytic plane with the physical ball contact offset and requested vertical depth', () => {
    const result = reliefProjectionPlan(plane(0.5), [line], ball, 0.2, 0.2);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const pass = result.passes[0];
    if (pass?.kind !== 'path3d') throw new Error('Expected 3D path.');
    const analyticLift = 0.5 * (Math.sqrt(1 + 0.5 * 0.5) - 1);
    for (const p of pass.points) expect(p.z).toBeCloseTo(-3 + 0.5 * p.x + analyticLift - 0.2, 5);
    expect(result.liftedVertices).toBeGreaterThan(0);
    expect(result.effectiveSpacingMm).toBe(0.05);
  });
  it('resamples long vectors and lifts an engraving over a mask hole instead of cutting its stock', () => {
    const map = { ...plane(), inclusion: new Uint8Array(576).fill(1) };
    for (let row = 0; row < 24; row += 1) map.inclusion[row * 24 + 11] = 0;
    const result = reliefProjectionPlan(
      map,
      [
        {
          closed: false,
          points: [
            { x: 1, y: 2 },
            { x: 3.5, y: 2 },
          ],
        },
      ],
      ball,
      0.5,
      0.3,
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    const pass = result.passes[0];
    if (pass?.kind !== 'path3d') throw new Error('Expected 3D path.');
    const overHole = pass.points.filter((p) => p.x >= 2.2 && p.x <= 2.4);
    expect(overHole.length).toBeGreaterThan(0);
    for (const p of overHole) expect(p.z).toBeGreaterThanOrEqual(0.001 - 1e-8);
    expect(map.depth[0]).toBe(-3);
  });
  it('preserves a closed vector and rejects an out-of-field or unbounded request explicitly', () => {
    const closed: Polyline = {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
    };
    const result = reliefProjectionPlan(plane(), [closed], ball, 0.2, 0.2);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const pass = result.passes[0];
    if (pass?.kind !== 'path3d') throw new Error('Expected 3D path.');
    expect(pass.points[0]).toEqual(pass.points[pass.points.length - 1]);
    expect(
      reliefProjectionPlan(
        plane(),
        [
          {
            closed: false,
            points: [
              { x: -1, y: 1 },
              { x: 2, y: 1 },
            ],
          },
        ],
        ball,
        0.2,
        0.2,
      ).kind,
    ).toBe('error');
    expect(reliefProjectionPlan(plane(), [line], ball, 0.2, 1e-8).kind).toBe('error');
  });
});

it('rejects an oversized physical cutter lattice before constructing contact storage', () => {
  const result = reliefProjectionPlan(plane(), [line], { ...ball, diameterMm: 1e9 }, 0.2, 0.2);
  expect(result).toMatchObject({
    kind: 'error',
    reason: expect.stringContaining('bounded relief lattice'),
  });
});
