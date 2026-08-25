// The stamped cone must follow the tool's ACTUAL position, not the centre of
// the cell it happens to land in.
//
// kernelForTool precomputes each offset's height from a whole-cell distance
// (hypot(dx, dy) * mmPerCell), so stampTip was effectively moving the tool to
// the nearest cell centre before cutting. For a 30 degree v-bit at 0.2 mm
// cells a half-cell error in radius is 0.1 / tan(15 deg) = 0.373 mm of depth,
// and because the error is locked to the cell lattice it appears as a regular
// field of uncut spikes inside a groove.

import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import { computeRemovalGrid, kernelForTool } from './index';

const CELL_MM = 0.2;
const TAN_HALF = Math.tan((15 * Math.PI) / 180);
const TIP_Z = -4;

const V_BIT: CncTool = {
  id: 'vb-30',
  name: '30° v-bit',
  kind: 'v-bit',
  diameterMm: 3.175,
  tipAngleDeg: 30,
};

function cellCentreMm(index: number): number {
  return (index + 0.5) * CELL_MM;
}

// One plunge stamps exactly one cone, which isolates stampTip from any
// along-path sampling.
function depthFieldForTipAt(
  x: number,
  y: number,
): {
  readonly at: (col: number, row: number) => number;
} {
  const toolpath = {
    steps: [{ kind: 'plunge', at: { x, y }, fromZ: 0, toZ: TIP_Z, length: -TIP_Z }],
    totalLength: -TIP_Z,
  } as never;
  const result = computeRemovalGrid(
    toolpath,
    { originX: 0, originY: 0, widthMm: 8.2, heightMm: 8.2, mmPerCell: CELL_MM },
    kernelForTool(V_BIT, CELL_MM),
    {},
  );
  if (result.kind !== 'ok') throw new Error('grid build failed');
  const grid = result.grid;
  return { at: (col, row) => grid.depth[row * grid.widthCells + col] ?? 0 };
}

describe('stampTip sub-cell placement', () => {
  const row = 20;
  const col = 20;
  const centre = cellCentreMm(col); // 4.10 mm

  it('cuts deeper on the side the tool actually sits toward', () => {
    // Tip near the RIGHT edge of cell 20, still inside it.
    const field = depthFieldForTipAt(centre + 0.09, cellCentreMm(row));
    const left = field.at(col - 1, row);
    const right = field.at(col + 1, row);
    // Snapping to the cell centre makes these identical; the true cone is
    // 0.18 mm closer to the right neighbour and so cuts it markedly deeper.
    expect(right).toBeLessThan(left - 0.3);
  });

  it('matches the cone the bit actually grinds', () => {
    const tipX = centre + 0.09;
    const field = depthFieldForTipAt(tipX, cellCentreMm(row));
    for (const offset of [-2, -1, 1, 2]) {
      const target = col + offset;
      const expected = TIP_Z + Math.abs(cellCentreMm(target) - tipX) / TAN_HALF;
      expect(field.at(target, row)).toBeCloseTo(Math.min(0, expected), 3);
    }
  });

  it('stays symmetric when the tool really is centred', () => {
    const field = depthFieldForTipAt(centre, cellCentreMm(row));
    expect(field.at(col - 1, row)).toBeCloseTo(field.at(col + 1, row), 6);
    expect(field.at(col, row)).toBeCloseTo(TIP_Z, 6);
  });

  it('never cuts beyond the tool radius', () => {
    const field = depthFieldForTipAt(centre, cellCentreMm(row));
    const outside = Math.ceil(V_BIT.diameterMm / 2 / CELL_MM) + 2;
    expect(field.at(col + outside, row)).toBe(0);
  });
});
