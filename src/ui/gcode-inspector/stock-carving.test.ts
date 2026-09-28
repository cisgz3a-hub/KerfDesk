import { describe, expect, it } from 'vitest';
import {
  carvesStock,
  createStockCarver,
  stockLayout,
  type StockMoves,
  type StockCarver,
} from './stock-carving';
import type { ProgramToolGeometry } from './program-tools';

// Moves given as [x0, y0, z0, x1, y1, z1].
function moves(
  list: ReadonlyArray<readonly number[]>,
  tools: ReadonlyArray<ProgramToolGeometry | null> = [{ kind: 'end-mill', diameterMm: 2 }],
): StockMoves {
  return {
    segmentCount: list.length,
    positions: new Float32Array(list.flat()),
    segTool: new Uint16Array(list.length),
    tools,
  };
}

// A 20 mm slot 1 mm deep along Y 0: down, across, up.
const SLOT = moves([
  [0, 0, 5, 0, 0, -1],
  [0, 0, -1, 20, 0, -1],
  [20, 0, -1, 20, 0, 5],
]);

function carver(program: StockMoves): StockCarver {
  const layout = stockLayout(program);
  if (layout === null) throw new Error('no stock');
  const made = createStockCarver(layout, program);
  if (made === null) throw new Error('no carver');
  return made;
}

function depthAt(made: StockCarver, x: number, y: number): number {
  const { grid } = made;
  const column = Math.floor((x - grid.originX) / grid.mmPerCell);
  const row = Math.floor((y - grid.originY) / grid.mmPerCell);
  return grid.depth[row * grid.widthCells + column] ?? NaN;
}

describe('the carved stock (ADR-487)', () => {
  it('lays the stock over the moves below Z0, with room for the bit', () => {
    const layout = stockLayout(SLOT);
    // The widest bit is the 3.175 mm stand-in: 1.5875 + 2 mm of room each side.
    expect(layout?.originX).toBeCloseTo(-3.5875);
    expect(layout?.widthMm).toBeCloseTo(27.175);
    expect(layout?.bottomZ).toBe(-2);
    expect(stockLayout(moves([[0, 0, 5, 10, 0, 0]]))).toBeNull();
    expect(carvesStock(SLOT)).toBe(true);
    expect(carvesStock(moves([[0, 0, 5, 10, 0, 0]]))).toBe(false);
  });

  it("sits the stock's bottom at the project's thickness when it is known", () => {
    expect(stockLayout(SLOT, 12)?.bottomZ).toBe(-12);
    // Thinner than the cut is deep: the cut goes through it.
    expect(stockLayout(SLOT, 0.5)?.bottomZ).toBe(-0.5);
    expect(stockLayout(SLOT, 0)?.bottomZ).toBe(-2);
  });

  it('carves as far as playback has got', () => {
    const made = carver(SLOT);
    // Half way along the cut: every move before it, and half of it.
    const change = made.carveTo({ index: 1, fraction: 0.5 });
    expect(change?.rowCount).toBeGreaterThan(0);
    expect(depthAt(made, 5, 0)).toBe(-1);
    expect(depthAt(made, 15, 0)).toBe(0);
    made.carveTo({ index: 3, fraction: 0 });
    expect(depthAt(made, 15, 0)).toBe(-1);
    // A 2 mm bit: 0.9 mm off the line is cut, 1.2 mm is not.
    expect(depthAt(made, 15, 0.9)).toBe(-1);
    expect(depthAt(made, 15, 1.2)).toBe(0);
  });

  it('starts again when playback goes back', () => {
    const made = carver(SLOT);
    made.carveTo({ index: 3, fraction: 0 });
    const change = made.carveTo({ index: 1, fraction: 0.25 });
    expect(change).toEqual({ firstRow: 0, rowCount: made.grid.heightCells });
    expect(depthAt(made, 2, 0)).toBe(-1);
    expect(depthAt(made, 15, 0)).toBe(0);
  });

  it('reports only the rows a carve reached, and nothing above the stock top', () => {
    // A rapid above the stock, then a short cut along Y 0.
    const made = carver(
      moves([
        [0, 10, 5, 0, 0, 5],
        [0, 0, -1, 5, 0, -1],
      ]),
    );
    expect(made.carveTo({ index: 1, fraction: 0 })).toBeNull();
    const change = made.carveTo({ index: 2, fraction: 0 });
    expect(change?.firstRow).toBeGreaterThan(0);
    expect((change?.firstRow ?? 0) + (change?.rowCount ?? 0)).toBeLessThan(made.grid.heightCells);
  });

  it('carves with a 3.175 mm end mill where the file gives no bit', () => {
    const made = carver(moves([[0, 0, -1, 20, 0, -1]], [null]));
    made.carveTo({ index: 1, fraction: 0 });
    expect(depthAt(made, 10, 1.4)).toBe(-1);
    expect(depthAt(made, 10, 1.8)).toBe(0);
  });

  it('keeps the grid about a million cells and every side a texture can hold', () => {
    const big = stockLayout(moves([[0, 0, -1, 1000, 1000, -1]]));
    const bigCells = ((big?.widthMm ?? 0) / (big?.mmPerCell ?? 1)) ** 2;
    expect(bigCells).toBeLessThan(1_010_000);
    const long = stockLayout(moves([[0, 0, -1, 3000, 0, -1]]));
    expect((long?.widthMm ?? 0) / (long?.mmPerCell ?? 1)).toBeLessThanOrEqual(2048);
    const small = stockLayout(moves([[0, 0, -1, 1, 0, -1]]));
    expect(small?.mmPerCell).toBe(0.05);
  });
});
