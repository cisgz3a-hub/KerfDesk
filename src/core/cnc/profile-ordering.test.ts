// Part-major ordering (the Drive/Safe field incident, 2026-08-01): a profile
// job with several letter-like parts must finish one part — its inner
// contours, then the outer that contains them — before travelling to the
// next part. The pre-fix order cut every hole across the whole scene first,
// hopping between words.

import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { orderInnerFirst } from './profile-ordering';

function ring(atX: number, atY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: atX, y: atY },
      { x: atX + size, y: atY },
      { x: atX + size, y: atY + size },
      { x: atX, y: atY + size },
    ],
  };
}

const outerA = ring(0, 0, 10);
const holeA = ring(3, 3, 4);
const outerB = ring(20, 0, 10);
const holeB = ring(23, 3, 4);

describe('orderInnerFirst', () => {
  it('completes each part (hole, then its outer) before the next part', () => {
    expect(orderInnerFirst([outerA, holeA, outerB, holeB])).toEqual([holeA, outerA, holeB, outerB]);
  });

  it('walks parts in the order their outers appear in the input', () => {
    expect(orderInnerFirst([outerB, outerA, holeA, holeB])).toEqual([holeB, outerB, holeA, outerA]);
  });

  it('keeps innermost-first inside a single part (unchanged from the old order)', () => {
    const outer = ring(0, 0, 30);
    const hole = ring(5, 5, 20);
    const island = ring(10, 10, 10);
    expect(orderInnerFirst([outer, hole, island])).toEqual([island, hole, outer]);
  });

  it('cuts an open detail inside a part before that part frees', () => {
    const engraveLine: Polyline = {
      closed: false,
      points: [
        { x: 2, y: 5 },
        { x: 8, y: 5 },
      ],
    };
    expect(orderInnerFirst([outerA, engraveLine, outerB])).toEqual([engraveLine, outerA, outerB]);
  });

  it('keeps a lone top-level contour at its input position between parts', () => {
    const lone: Polyline = {
      closed: false,
      points: [
        { x: 14, y: 0 },
        { x: 16, y: 0 },
      ],
    };
    expect(orderInnerFirst([outerA, holeA, lone, outerB, holeB])).toEqual([
      holeA,
      outerA,
      lone,
      holeB,
      outerB,
    ]);
  });

  it('returns single-contour and empty inputs unchanged', () => {
    expect(orderInnerFirst([outerA])).toEqual([outerA]);
    expect(orderInnerFirst([])).toEqual([]);
  });
});
