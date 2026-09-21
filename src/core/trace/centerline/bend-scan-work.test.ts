// The bend scan visits every vertex of a chain. Anything it copies per
// candidate is therefore paid once per point of a chain that is itself points
// long, and a dense traced contour is thousands of points: the scan used to
// rotate the whole ring to centre each candidate and slice two legs out of it
// to measure them, which made one closed contour quadratic in its own length.
// The tangent legs now use index walks. One full-ring rotation still remains
// per admitted candidate, so the closed scan can still be quadratic.

import { describe, expect, it, vi } from 'vitest';
import type { Vec2 } from '../../scene';
import { sharpenChainBends } from './sharpen-bends';
import { trimArc } from './polyline-window';

/**
 * A ring that steps between two radii every few points, so the cheap turn gate
 * admits candidate after candidate and the scan actually reaches the bend
 * window — a smooth ring is rejected before any of this work happens.
 */
function zigzagRing(points: number, period = 8, amplitude = 14): Vec2[] {
  const ring: Vec2[] = [];
  for (let k = 0; k < points; k += 1) {
    const t = (k / points) * Math.PI * 2;
    const radius = 90 + (k % period < period / 2 ? 0 : amplitude);
    ring.push({ x: 128 + radius * Math.cos(t), y: 128 + radius * Math.sin(t) });
  }
  return ring;
}

// The pre-rewrite trimArc, kept as the reference the index walk must match.
function referenceTrimArc(points: ReadonlyArray<Vec2>, end: 'head' | 'tail', arc: number): Vec2[] {
  const pts = end === 'head' ? [...points].reverse() : [...points];
  let cum = 0;
  let keep = pts.length - 1;
  for (let i = pts.length - 1; i > 0; i -= 1) {
    const a = pts[i];
    const b = pts[i - 1];
    if (a === undefined || b === undefined) break;
    cum += Math.hypot(a.x - b.x, a.y - b.y);
    keep = i;
    if (cum > arc) break;
  }
  const trimmed = pts.slice(0, keep);
  return end === 'head' ? trimmed.reverse() : trimmed;
}

describe('bend scan work', () => {
  it('avoids slice and reverse copies while scanning an unchanged closed chain', () => {
    const ring = zigzagRing(600);
    // An empty distance field reports no ink anywhere, so every candidate is
    // rejected and no chain is rebuilt. This measures the removed slice and
    // reverse calls, not all allocations: rotateRing still copies each ring
    // manually. Before the rewrite, rotating the ring per
    // candidate and slicing two legs out of it cost 5,394 slices and 2,098
    // reversals for 600 points — nine array copies per point of the chain.
    const slice = vi.spyOn(Array.prototype, 'slice');
    const reverse = vi.spyOn(Array.prototype, 'reverse');
    let result;
    let copies = { slices: -1, reversals: -1 };
    try {
      result = sharpenChainBends(ring, true, new Float64Array(0), 0);
      // Read the counts BEFORE restoring: mockRestore also clears the record.
      copies = { slices: slice.mock.calls.length, reversals: reverse.mock.calls.length };
    } finally {
      slice.mockRestore();
      reverse.mockRestore();
    }
    expect(result.points).toEqual(ring);
    expect(result.corners.size).toBe(0);
    expect(copies).toEqual({ slices: 0, reversals: 0 });
  });

  it('trims an arc off a long chain without reversing it', () => {
    const ring = zigzagRing(4000);
    const reverse = vi.spyOn(Array.prototype, 'reverse');
    let head;
    let tail;
    let reversals = -1;
    try {
      head = trimArc(ring, 'head', 5);
      tail = trimArc(ring, 'tail', 5);
      reversals = reverse.mock.calls.length;
    } finally {
      reverse.mockRestore();
    }
    // Trimming from the head used to reverse the whole chain, slice it, and
    // reverse the result back, to drop a handful of points from one end.
    expect(reversals).toBe(0);
    expect(head.at(-1)).toBe(ring.at(-1));
    expect(tail[0]).toBe(ring[0]);
  });

  it.each(['head', 'tail'] as const)('trims the same points as the reference (%s)', (end) => {
    const shapes: Vec2[][] = [
      [],
      [{ x: 3, y: 4 }],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      zigzagRing(37, 6, 9),
      Array.from({ length: 60 }, (_, k) => ({ x: k * 0.25, y: Math.sin(k) * 0.1 })),
    ];
    for (const shape of shapes) {
      for (const arc of [0, 0.5, 1, 3, 7.5, 1e6]) {
        expect(trimArc(shape, end, arc)).toEqual(referenceTrimArc(shape, end, arc));
      }
    }
  });
});
