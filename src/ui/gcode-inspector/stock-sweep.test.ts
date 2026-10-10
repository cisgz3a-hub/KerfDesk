import { describe, expect, it } from 'vitest';
import type { CncTool } from '../../core/scene';
import { createRemovalGrid, type RemovalGrid } from '../../core/sim/removal-grid';
import { kernelForTool } from '../../core/sim/tool-kernels';
import { sweepMove, type SweptRows } from './stock-sweep';

const CELL = 0.1;

// 40 x 20 mm from (-10, -10), in 0.1 mm cells.
function grid(): RemovalGrid {
  const made = createRemovalGrid({
    originX: -10,
    originY: -10,
    widthMm: 40,
    heightMm: 20,
    mmPerCell: CELL,
  });
  if (made.kind === 'error') throw new Error(made.reason);
  return made.grid;
}

function tool(kind: CncTool['kind'], diameterMm: number, tipAngleDeg?: number): CncTool {
  return {
    id: '',
    name: '',
    kind,
    diameterMm,
    ...(tipAngleDeg === undefined ? {} : { tipAngleDeg }),
  };
}

// The depth of the cell whose centre is nearest (x, y).
function depthAt(on: RemovalGrid, x: number, y: number): number {
  const column = Math.floor((x - on.originX) / CELL);
  const row = Math.floor((y - on.originY) / CELL);
  return on.depth[row * on.widthCells + column] ?? NaN;
}

function sweep(
  on: RemovalGrid,
  bit: CncTool,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  upTo = 1,
): SweptRows {
  const rows = { first: Infinity, last: -Infinity };
  const [ax, ay, az] = from;
  const [bx, by, bz] = to;
  sweepMove(
    on,
    kernelForTool(bit, CELL),
    { x: ax, y: ay, z: az },
    { x: bx, y: by, z: bz },
    upTo,
    rows,
  );
  return rows;
}

describe('sweeping a bit along a move (ADR-487)', () => {
  it('cuts a flat slot the width of an end mill, and its rows', () => {
    const on = grid();
    const rows = sweep(on, tool('end-mill', 4), [0, 0, -1], [20, 0, -1]);
    expect(depthAt(on, 10, 0)).toBe(-1);
    expect(depthAt(on, 10, 1.95)).toBe(-1);
    expect(depthAt(on, 10, 2.15)).toBe(0);
    // The ends are round: 1.9 mm off the end along the diagonal is outside.
    expect(depthAt(on, 21.45, 1.45)).toBe(0);
    expect(depthAt(on, 21.35, 0.05)).toBe(-1);
    expect(rows).toEqual({ first: 80, last: 120 });
  });

  it('follows a ramp with a flat bottom to its lowest point under the bit', () => {
    const on = grid();
    sweep(on, tool('end-mill', 4), [0, 0, 0], [20, 0, -2]);
    // Half way, the bit reaches 2 mm further on, 0.2 mm deeper.
    expect(depthAt(on, 10.05, 0.05)).toBeCloseTo(-1.205, 2);
    // Off to the side it reaches less far on.
    expect(depthAt(on, 10.05, 1.95)).toBeCloseTo(-1.03, 1);
    expect(depthAt(on, 21.05, 0.05)).toBeCloseTo(-2, 5);
  });

  it('cuts a round groove with a ball nose on a level move', () => {
    const on = grid();
    sweep(on, tool('ball-nose', 6), [0, 0, -3], [20, 0, -3]);
    expect(depthAt(on, 10, 0.05)).toBeCloseTo(-3, 2);
    // 3 - sqrt(9 - 2.05^2) above the bottom at 2.05 mm off the line.
    expect(depthAt(on, 10, 2.05)).toBeCloseTo(-3 + (3 - Math.sqrt(9 - 2.05 ** 2)), 5);
  });

  it('stamps a V bit down a slope at every cell, cutting nothing above the top', () => {
    const on = grid();
    sweep(on, tool('v-bit', 6, 90), [0, 0, 0.5], [10, 0, -1.5]);
    // Each cell takes the cone at its centre's true distance from the tip
    // (ADR-580): a 90 degree V cuts that distance shallower than the tip.
    // The cell read at (10, 0) is centred at (10.05, 0.05).
    expect(depthAt(on, 10, 0)).toBeCloseTo(-1.5 + Math.hypot(0.05, 0.05), 5);
    expect(depthAt(on, 10, 1)).toBeCloseTo(-1.5 + Math.hypot(0.05, 1.05), 5);
    expect(depthAt(on, 1, 0)).toBe(0);
  });

  it('sweeps only as far along the move as asked', () => {
    const on = grid();
    sweep(on, tool('end-mill', 2), [0, 0, -1], [20, 0, -1], 0.25);
    expect(depthAt(on, 4.5, 0)).toBe(-1);
    expect(depthAt(on, 7, 0)).toBe(0);
    // Above the stock nothing is cut and no rows are reached.
    expect(sweep(on, tool('end-mill', 2), [0, 0, 1], [20, 0, 1])).toEqual({
      first: Infinity,
      last: -Infinity,
    });
  });
});
