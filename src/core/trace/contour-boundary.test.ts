import { describe, expect, it } from 'vitest';
import type { InkMask } from './centerline';
import { midCrackChain, traceBoundaryLoops } from './contour-boundary';
import { createSaddleResolver, type TurnPolicy } from './saddle-connectivity';

function maskFrom(rows: ReadonlyArray<string>): InkMask {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const ink = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x += 1) ink[y * width + x] = row[x] === '#' ? 1 : 0;
  });
  return { width, height, ink };
}

function inkCount(mask: InkMask): number {
  let n = 0;
  for (const v of mask.ink) n += v;
  return n;
}

describe('traceBoundaryLoops', () => {
  it('traces a single pixel as one 4-corner loop of area 1', () => {
    const loops = traceBoundaryLoops(maskFrom(['#']));
    expect(loops).toHaveLength(1);
    expect(loops[0]?.points).toHaveLength(4);
    expect(loops[0]?.area).toBe(1);
  });

  it('traces a 2×2 block as one 8-corner loop of area 4', () => {
    const loops = traceBoundaryLoops(maskFrom(['##', '##']));
    expect(loops).toHaveLength(1);
    expect(loops[0]?.points).toHaveLength(8);
    expect(loops[0]?.area).toBe(4);
  });

  it('emits a hole as a second loop with opposite orientation', () => {
    const loops = traceBoundaryLoops(maskFrom(['###', '#.#', '###']));
    expect(loops).toHaveLength(2);
    const areas = loops.map((l) => l.area).sort((a, b) => a - b);
    expect(areas).toEqual([-1, 9]);
  });

  it('keeps diagonally-touching pixels as separate loops by default (historical rule)', () => {
    const loops = traceBoundaryLoops(maskFrom(['#.', '.#']));
    expect(loops).toHaveLength(2);
    expect(loops.every((l) => l.area === 1)).toBe(true);
  });

  it('signed loop areas sum to the ink pixel count (holes subtract)', () => {
    const mask = maskFrom(['#####', '#...#', '#.#.#', '#...#', '#####']);
    const loops = traceBoundaryLoops(mask);
    const total = loops.reduce((sum, l) => sum + l.area, 0);
    expect(total).toBe(inkCount(mask));
  });

  it('is deterministic', () => {
    const rows = ['.##..', '####.', '.###.', '..#..'];
    expect(traceBoundaryLoops(maskFrom(rows))).toEqual(traceBoundaryLoops(maskFrom(rows)));
  });
});

function loopsWith(rows: ReadonlyArray<string>, policy: TurnPolicy) {
  const mask = maskFrom(rows);
  return traceBoundaryLoops(mask, createSaddleResolver(mask, policy));
}

function signedTotal(loops: ReadonlyArray<{ readonly area: number }>): number {
  return loops.reduce((sum, loop) => sum + loop.area, 0);
}

describe('traceBoundaryLoops saddle policy (ADR-403)', () => {
  // Kept one pixel off the image corners: a saddle diagonally next to an
  // image corner has no window ring and is a tie (saddle-connectivity.ts).
  const hairline = [
    '........',
    '.#......',
    '..#.....',
    '...#....',
    '....#...',
    '.....#..',
    '......#.',
    '........',
  ];

  it('connect-ink walks a diagonal pixel pair as one pinched loop', () => {
    const loops = loopsWith(['#.', '.#'], 'connect-ink');
    expect(loops).toHaveLength(1);
    expect(loops[0]?.area).toBe(2);
    expect(loops[0]?.points).toHaveLength(8);
  });

  it('auto keeps a one-pixel diagonal hairline as ONE loop, area = pixel count', () => {
    const loops = loopsWith(hairline, 'auto');
    expect(loops).toHaveLength(1);
    expect(loops[0]?.area).toBe(6);
    expect(loopsWith(hairline, 'connect-paper')).toHaveLength(6);
  });

  it('pinched loops never touch themselves after the mid-crack step', () => {
    const loop = loopsWith(hairline, 'auto')[0];
    const chain = midCrackChain(loop?.points ?? []);
    const n = chain.length;
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 2; j < n; j += 1) {
        if (i === 0 && j === n - 1) continue;
        const a = chain[i];
        const b = chain[j];
        if (a === undefined || b === undefined) continue;
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    // The two passes through each saddle corner run ~0.71px apart.
    expect(closest).toBeGreaterThan(0.7);
  });

  it('keeps two squares that touch at one corner as two loops under auto', () => {
    const rows = ['###...', '###...', '###...', '...###', '...###', '...###'];
    expect(loopsWith(rows, 'auto').map((l) => l.area)).toEqual([9, 9]);
    expect(loopsWith(rows, 'connect-ink').map((l) => l.area)).toEqual([18]);
  });

  it('turns a closed diagonal ring into an outer loop plus an opposite hole', () => {
    const diamond = ['..#..', '.#.#.', '#...#', '.#.#.', '..#..'];
    const loops = loopsWith(diamond, 'auto');
    expect(loops).toHaveLength(2);
    const areas = loops.map((l) => l.area).sort((a, b) => a - b);
    // The hole is the 5 enclosed paper pixels: the orientation opposes the
    // outer loop and the signed total is still the ink pixel count.
    expect(areas).toEqual([-5, 13]);
    expect(signedTotal(loops)).toBe(8);
  });

  it('gives a checkerboard of 2×2 cells a deterministic, documented topology', () => {
    const cells = ['##..##..', '##..##..', '..##..##', '..##..##', '##..##..', '##..##..'];
    const auto = loopsWith(cells, 'auto');
    // Every interior saddle is an exact 8/16 window tie → paper joins: each
    // 2×2 ink cell is its own loop, identical to the historical rule.
    expect(auto.map((l) => l.area)).toEqual(Array.from({ length: 6 }, () => 4));
    expect(auto).toEqual(loopsWith(cells, 'connect-paper'));
    // connect-ink welds every cell into one outline; enclosed paper cells
    // become holes, and the signed total never changes.
    const ink = loopsWith(cells, 'connect-ink');
    expect(ink.map((l) => l.area).sort((a, b) => a - b)).toEqual([-4, 28]);
    expect(signedTotal(ink)).toBe(24);
    expect(loopsWith(cells, 'connect-ink')).toEqual(ink);
  });

  it('gives a one-pixel checkerboard the same deterministic answer, border included', () => {
    // Every saddle ties — also at the image corners, where the window's
    // missing row/column is mirrored and continues the board's parity — so
    // every ink pixel is its own unit loop, exactly the historical result.
    for (const board of [
      ['#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#'],
      ['#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '.#.#.#.#'],
      ['#.#.', '.#.#', '#.#.', '.#.#'],
    ]) {
      const auto = loopsWith(board, 'auto');
      const inkPixels = board.join('').split('#').length - 1;
      expect(auto.map((loop) => loop.area)).toEqual(Array.from({ length: inkPixels }, () => 1));
      expect(auto).toEqual(loopsWith(board, 'connect-paper'));
    }
  });
});

describe('midCrackChain', () => {
  it('maps a unit-square staircase to its four edge midpoints', () => {
    const loop = traceBoundaryLoops(maskFrom(['#']))[0];
    expect(loop).toBeDefined();
    const mid = midCrackChain(loop?.points ?? []);
    expect(mid).toHaveLength(4);
    const xs = mid.map((p) => p.x).sort((a, b) => a - b);
    const ys = mid.map((p) => p.y).sort((a, b) => a - b);
    expect(xs).toEqual([0, 0.5, 0.5, 1]);
    expect(ys).toEqual([0, 0.5, 0.5, 1]);
  });
});
