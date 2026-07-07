import { describe, expect, it } from 'vitest';
import type { InkMask } from './centerline';
import { midCrackChain, traceBoundaryLoops } from './contour-boundary';

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

  it('keeps diagonally-touching pixels as separate loops (right-turn policy)', () => {
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
