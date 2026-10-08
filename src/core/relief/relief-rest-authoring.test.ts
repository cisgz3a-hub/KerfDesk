import { describe, expect, it } from 'vitest';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import { predictReliefResidual } from './relief-residual-stock';
import { reliefRestPasses } from './relief-rest-passes';

const flat: CncTool = { id: 'wide', name: 'Wide', kind: 'end-mill', diameterMm: 3 };
function map(cells = 24, cell = 0.25, depth = -2): Heightmap {
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: cells * cell,
    heightMm: cells * cell,
    mmPerCell: cell,
    depth: new Float32Array(cells * cells).fill(depth),
  };
}
const pass: CncPass = {
  kind: 'path3d',
  closed: false,
  points: [
    { x: 0, y: 3, z: -2 },
    { x: 6, y: 3, z: -2 },
  ],
};

describe('conservative relief rest selection', () => {
  it('omits fully reached flat cells and selects an unreachable deeper detail', () => {
    const target = map();
    const original = target.depth.slice();
    const clean = predictReliefResidual(target, [pass], flat, 0.05);
    expect(clean.selected[12 * 24 + 12]).toBe(0);
    expect(clean.selected[0]).toBe(1);
    target.depth[12 * 24 + 12] = -4;
    const detail = predictReliefResidual(target, [pass], flat, 0.05);
    expect(detail.selected[12 * 24 + 12]).toBe(1);
    expect(detail.maximumResidualMm).toBe(2);
    expect(original[12 * 24 + 12]).toBe(-2);
  });
  it('never omits residual shown by an independent analytic sphere swept along a plane', () => {
    const target = map(32, 0.125);
    const ball: CncTool = { ...flat, kind: 'ball-nose', diameterMm: 2 };
    const path: CncPass = {
      kind: 'path3d',
      closed: false,
      points: [
        { x: 0, y: 2, z: -2 },
        { x: 4, y: 2, z: -2 },
      ],
    };
    const selected = predictReliefResidual(target, [path], ball, 0.08);
    let actualRemaining = 0;
    for (let y = 0; y < 32; y += 1)
      for (let x = 0; x < 32; x += 1) {
        const dy = Math.abs((y + 0.5) * 0.125 - 2);
        const actualStock = dy <= 1 ? -2 + 1 - Math.sqrt(1 - dy * dy) : 0;
        if (actualStock + 2 > 0.08) {
          expect(selected.selected[y * 32 + x]).toBe(1);
          actualRemaining += 1;
        }
      }
    expect(actualRemaining).toBeGreaterThan(0);
  });
  it('ignores excluded cells and retains all included work when prediction is too large', () => {
    const target = { ...map(), inclusion: new Uint8Array(24 * 24).fill(1) };
    target.inclusion[0] = 0;
    const long: CncPass = {
      kind: 'path3d',
      closed: false,
      points: [
        { x: -1e8, y: 3, z: -2 },
        { x: 1e8, y: 3, z: -2 },
      ],
    };
    const result = predictReliefResidual(target, [long], flat, 0.05);
    expect(result.fallbackReason).toContain('full fine finishing');
    expect(result.selectedCells).toBe(575);
    expect(result.selected[0]).toBe(0);
  });
  it('trims checked moves without changing their straight XYZ interpolation', () => {
    const target = map(40, 0.25);
    const selected = new Uint8Array(1600);
    selected[20 * 40 + 20] = 1;
    const fine: CncPass = {
      kind: 'path3d',
      closed: false,
      points: [
        { x: 0, y: 5.125, z: -1 },
        { x: 10, y: 5.125, z: -3 },
      ],
    };
    const result = reliefRestPasses(target, [fine], selected, 0.1);
    expect(result.passes).toHaveLength(1);
    const trimmed = result.passes[0];
    if (trimmed?.kind !== 'path3d') throw new Error('Expected 3D moves.');
    expect(trimmed.points[0]?.x).toBeGreaterThan(3);
    expect(trimmed.points[trimmed.points.length - 1]?.x).toBeLessThan(7);
    for (const point of trimmed.points) expect(point.z).toBeCloseTo(-1 - 0.2 * point.x, 12);
    expect(reliefRestPasses(target, [fine], new Uint8Array(1600), 0.1).passes).toEqual([]);
  });
});

it('retains full fine selection when the predecessor cutter lattice cannot fit its sampling budget', () => {
  const result = predictReliefResidual(map(), [pass], { ...flat, diameterMm: 1e9 }, 0.05);
  expect(result.selectedCells).toBe(24 * 24);
  expect(result.fallbackReason).toContain('full fine finishing');
});
