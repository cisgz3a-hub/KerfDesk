import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import { paintTopView, topViewGrid, type TopViewGrid } from './top-view-image';

const SIZE = { width: 116, height: 116 };

// Moves given as [x0, y0, z0, x1, y1, z1, kind].
function program(moves: ReadonlyArray<readonly number[]>) {
  return {
    segmentCount: moves.length,
    positions: new Float32Array(moves.flatMap((move) => move.slice(0, 6))),
    segKind: new Uint8Array(moves.map((move) => move[6] ?? SEG_KIND.cut)),
  };
}

// The move a pixel shows, or -1 for none.
function shown(grid: TopViewGrid | null, column: number, row: number): number {
  if (grid === null) throw new Error('no image');
  return (grid.moves[row * grid.width + column] ?? 0) - 1;
}

describe('the program from above (ADR-485)', () => {
  it('draws cuts, not rapids, fitted in the middle with Y up', () => {
    // A cut along the bottom, a rapid up the right side, a cut along the top.
    const grid = topViewGrid(
      program([
        [0, 0, -1, 100, 0, -1],
        [100, 0, 5, 100, 50, 5, SEG_KIND.travel],
        [100, 50, -1, 0, 50, -1],
      ]),
      SIZE,
    );
    expect(grid?.moves).toHaveLength(116 * 116);
    // 100 mm across 100 pixels, 50 mm tall, centred: Y 0 is row 83, Y 50 row 33.
    expect(shown(grid, 58, 83)).toBe(0);
    expect(shown(grid, 58, 33)).toBe(2);
    expect(shown(grid, 58, 58)).toBe(-1);
    expect(shown(grid, 108, 58)).toBe(-1);
  });

  it('shows the deepest move where moves cross, the later one on a tie', () => {
    const grid = topViewGrid(
      program([
        [0, 0, -2, 100, 0, -2],
        [50, -10, -1, 50, 10, -1],
        [0, 10, -1, 100, 10, -1],
      ]),
      SIZE,
    );
    // 20 mm tall from Y -10, centred: Y 0 is row 58 and Y 10 is row 48.
    expect(shown(grid, 58, 58)).toBe(0);
    expect(shown(grid, 58, 48)).toBe(2);
    expect(shown(grid, 58, 53)).toBe(1);
  });

  it('paints each pixel in its move colour, as the 3D view shows it', () => {
    const grid = topViewGrid(program([[0, 0, 0, 100, 0, 0]]), SIZE);
    if (grid === null) throw new Error('no image');
    const asked: number[] = [];
    const pixels = paintTopView(grid, (index) => (asked.push(index), [1, 0.2, 0]), 0x102030);
    expect(pixels).toHaveLength(116 * 116 * 4);
    expect([...pixels.subarray(0, 4)]).toEqual([0x10, 0x20, 0x30, 255]);
    const on = (58 * 116 + 58) * 4;
    // Linear 0.2 shows as sRGB 124 on screen.
    expect([...pixels.subarray(on, on + 4)]).toEqual([255, 124, 0, 255]);
    // Neighbouring pixels of one move ask for its colour once.
    expect(asked.length).toBeLessThan(10);
  });

  it('draws nothing for rapids alone or no room', () => {
    const rapids = program([[0, 0, 5, 10, 10, 5, SEG_KIND.travel]]);
    expect(topViewGrid(rapids, SIZE)).toBeNull();
    expect(topViewGrid(program([[0, 0, 0, 10, 10, 0]]), { width: 0, height: 50 })).toBeNull();
  });
});
