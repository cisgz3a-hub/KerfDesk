import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import { reliefRoughingPasses } from './relief-roughing';
import { reliefRoughingLevels } from './relief-roughing-levels';

const CELLS = 24;
const CELL_MM = 0.5;
const END_MILL: CncTool = { id: 'em', name: 'end mill', kind: 'end-mill', diameterMm: 1 };

// A map whose depth (and, for the level tests, tip) is `depthAt(x, y)` in mm.
function map(depthAt: (x: number, y: number) => number): Heightmap {
  const depth = new Float32Array(CELLS * CELLS);
  for (let y = 0; y < CELLS; y += 1) {
    for (let x = 0; x < CELLS; x += 1) depth[y * CELLS + x] = depthAt(x, y);
  }
  return {
    widthCells: CELLS,
    heightCells: CELLS,
    widthMm: CELLS * CELL_MM,
    heightMm: CELLS * CELL_MM,
    mmPerCell: CELL_MM,
    depth,
  };
}

// Floor at -3 with a raised square plateau at -1.3 in the middle.
const plateau = (x: number, y: number): number =>
  x >= 8 && x < 16 && y >= 8 && y < 16 ? -1.3 : -3;

describe('reliefRoughingLevels (ADR-422)', () => {
  it('replaces ladder levels below the deepest tip with one level at it', () => {
    const floor = map(() => -2.5);
    const levels = reliefRoughingLevels(floor, floor.depth, [-1, -2, -3], 0.5);

    expect(levels.map((level) => level.zMm)).toEqual([-1, -2, -2.5]);
    expect(levels.every((level) => level.bandFloorMm === null)).toBe(true);
    expect(levels.map((level) => level.sliceTopMm)).toEqual([0, -1, -2]);
  });

  it('adds a banded level at a flat that falls between ladder levels', () => {
    const tips = map((x, y) => plateau(x, y) + 0.5);
    const levels = reliefRoughingLevels(tips, tips.depth, [-1, -2, -3], 0.5);

    expect(levels).toEqual([
      { zMm: expect.closeTo(-0.8, 6), bandFloorMm: -1, sliceTopMm: 0 },
      { zMm: -1, bandFloorMm: null, sliceTopMm: 0 },
      { zMm: -2, bandFloorMm: null, sliceTopMm: -1 },
      { zMm: -2.5, bandFloorMm: null, sliceTopMm: -2 },
    ]);
  });

  it('skips a flat a ladder level already reaches within the minimum step', () => {
    const tips = map((x, y) => (x >= 8 && x < 16 && y >= 8 && y < 16 ? -2.03 : -2.5));
    const levels = reliefRoughingLevels(tips, tips.depth, [-1, -2, -3], 0.5);

    expect(levels.map((level) => level.zMm)).toEqual([-1, -2, -2.5]);
  });

  it('never takes a contour line of equal tips for a flat', () => {
    // A square pyramid: each ring of cells shares one tip, but no cell's four
    // neighbours share it, so there is no flat below the apex.
    const center = (CELLS - 1) / 2;
    const pyramid = map((x, y) => -0.25 * Math.max(Math.abs(x - center), Math.abs(y - center)));
    const levels = reliefRoughingLevels(pyramid, pyramid.depth, [-1, -2, -3], 0.5);

    expect(levels.map((level) => level.zMm)).toEqual([-1, -2, expect.closeTo(-2.875, 6)]);
  });

  it('cuts nothing when the allowance leaves no tip below stock top', () => {
    const top = map(() => 0);
    expect(reliefRoughingLevels(top, top.depth, [-1], 0.5)).toEqual([]);
  });
});

describe('reliefRoughingPasses levels (ADR-422)', () => {
  it('clears the plateau and the floor down to their allowance', () => {
    const passes = reliefRoughingPasses(map(plateau), {
      tool: END_MILL,
      reliefDepthMm: 3,
      depthPerPassMm: 1,
      stepoverPercent: 40,
      allowanceMm: 0.5,
    });
    const levels = [...new Set(passes.map((pass) => (pass.kind === 'contour' ? pass.zMm : 0)))];

    expect(levels).toContainEqual(expect.closeTo(-0.8, 6));
    expect(levels).toContainEqual(expect.closeTo(-2.5, 6));
    expect(Math.min(...levels)).toBeCloseTo(-2.5, 6);
  });
});
