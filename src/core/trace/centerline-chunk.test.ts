import { describe, expect, it } from 'vitest';
import { type Chunk, chunkExits, chunkSegments, inkCentroid } from './centerline-chunk';

function mask(width: number, height: number, ink: ReadonlyArray<[number, number]>): Uint8Array {
  const m = new Uint8Array(width * height);
  for (const [x, y] of ink) m[y * width + x] = 1;
  return m;
}

function hline(y: number, x0: number, x1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = x0; x <= x1; x += 1) out.push([x, y]);
  return out;
}

function vline(x: number, y0: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y += 1) out.push([x, y]);
  return out;
}

const SIZE = 7;
const FULL: Chunk = { x: 0, y: 0, w: SIZE, h: SIZE };

describe('chunkSegments', () => {
  it('a straight stroke crossing the chunk -> one segment joining the two crossings', () => {
    const m = mask(SIZE, SIZE, hline(3, 0, 6));
    expect(chunkExits(m, SIZE, FULL)).toHaveLength(2);
    const segs = chunkSegments(m, SIZE, FULL);
    expect(segs).toHaveLength(1);
    const xs = segs[0]!.map((p) => p.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, 6]);
  });

  it('a stroke ending inside -> one stub from the crossing to the centroid', () => {
    const m = mask(SIZE, SIZE, hline(3, 3, 6));
    expect(chunkExits(m, SIZE, FULL)).toHaveLength(1);
    expect(chunkSegments(m, SIZE, FULL)).toHaveLength(1);
  });

  it('a cross -> a crossroad: one segment per arm to the centre', () => {
    const m = mask(SIZE, SIZE, [...hline(3, 0, 6), ...vline(3, 0, 6)]);
    expect(chunkExits(m, SIZE, FULL)).toHaveLength(4);
    expect(chunkSegments(m, SIZE, FULL)).toHaveLength(4);
    const c = inkCentroid(m, SIZE, FULL);
    expect(c?.x).toBeCloseTo(3, 5);
    expect(c?.y).toBeCloseTo(3, 5);
  });

  it('empty chunk -> no segments', () => {
    expect(chunkSegments(mask(SIZE, SIZE, []), SIZE, FULL)).toHaveLength(0);
  });
});
