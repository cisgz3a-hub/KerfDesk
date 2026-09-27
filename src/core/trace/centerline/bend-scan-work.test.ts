// The bend scan visits every vertex of a chain. Anything it copies per
// candidate is therefore paid once per point of a chain that is itself points
// long, and a dense traced contour is thousands of points: the scan used to
// rotate the whole ring to centre each candidate and slice two legs out of it
// to measure them, which made one closed contour quadratic in its own length.
// The tangent legs now use index walks, each candidate is judged on a bounded
// stretch of ring rather than a rotated copy of it, and a rebuilt corner only
// re-queues the candidates whose stretch it touched (ADR-438).

import { describe, expect, it, vi } from 'vitest';
import type { Vec2 } from '../../scene';
import { createBendBudget, sharpenChainBends, sharpenChainBendsSteps } from './sharpen-bends';
import { runTraceSteps } from '../trace-steps';
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
    // reverse calls. Before the rewrite, rotating the ring per
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

// A star of `tips` points drawn as one dense closed chain whose every corner
// is chamfered, the way thinning and mid-crack tracing leave drawn corners.
function chamferedStar(tips: number): { readonly points: Vec2[]; readonly corners: Vec2[] } {
  const corners: Vec2[] = [];
  for (let k = 0; k < tips * 2; k += 1) {
    const angle = (k / (tips * 2)) * 2 * Math.PI;
    const radius = k % 2 === 0 ? 150 : 110;
    corners.push({ x: 200 + radius * Math.cos(angle), y: 200 + radius * Math.sin(angle) });
  }
  const points: Vec2[] = [];
  for (let k = 0; k < corners.length; k += 1) {
    const prev = corners[(k - 1 + corners.length) % corners.length] as Vec2;
    const corner = corners[k] as Vec2;
    const next = corners[(k + 1) % corners.length] as Vec2;
    const exit = toward(corner, next, 1.5);
    points.push(toward(corner, prev, 1.5), exit);
    const end = toward(next, corner, 1.5);
    const steps = Math.max(1, Math.floor(Math.hypot(end.x - exit.x, end.y - exit.y)));
    for (let s = 1; s < steps; s += 1) {
      points.push({
        x: exit.x + ((end.x - exit.x) * s) / steps,
        y: exit.y + ((end.y - exit.y) * s) / steps,
      });
    }
  }
  return { points, corners };
}

function toward(from: Vec2, to: Vec2, distance: number): Vec2 {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return {
    x: from.x + ((to.x - from.x) / len) * distance,
    y: from.y + ((to.y - from.y) / len) * distance,
  };
}

const FIELD_WIDTH = 400;
// Uniform 3 px stroke radius: every wedge has ink support.
const INKED_FIELD = new Float64Array(FIELD_WIDTH * FIELD_WIDTH).fill(9);

function restoredCorners(points: ReadonlyArray<Vec2>, corners: ReadonlyArray<Vec2>): number {
  return corners.filter((corner) =>
    points.some((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 0.9),
  ).length;
}

describe('closed-ring corner rebuild work', () => {
  it('rebuilds every corner of a many-cornered ring in work linear in the ring', () => {
    // 80 drawn corners on one ring. The rotate-and-restart scan re-judged
    // every admitted vertex after each rebuilt corner (roughly corners x
    // admitted vertices, ~20k gate attempts here); the worklist scan re-judges
    // only the neighbourhood each corner changed.
    const { points, corners } = chamferedStar(40);
    const budget = createBendBudget(0);
    const start = budget.attemptsLeft;
    const sharpened = runTraceSteps(
      sharpenChainBendsSteps(points, true, INKED_FIELD, FIELD_WIDTH, undefined, budget),
    );
    expect(restoredCorners(sharpened.points, corners)).toBe(corners.length);
    expect(sharpened.corners.size).toBe(corners.length);
    expect(start - budget.attemptsLeft).toBeLessThan(points.length);
  });

  it('rebuilds the same corners wherever the ring starts, including mid-chamfer', () => {
    const { points, corners } = chamferedStar(9);
    const key = (p: Vec2): string => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    const reference = [...sharpenChainBends(points, true, INKED_FIELD, FIELD_WIDTH).corners]
      .map(key)
      .sort();
    expect(reference).toHaveLength(corners.length);
    // Offset 1 puts a chamfer across the seam; the others land mid-edge.
    for (const offset of [1, 7, Math.floor(points.length / 2)]) {
      const rotated = [...points.slice(offset), ...points.slice(0, offset)];
      const sharpened = sharpenChainBends(rotated, true, INKED_FIELD, FIELD_WIDTH);
      expect([...sharpened.corners].map(key).sort()).toEqual(reference);
    }
  });

  it('stops rebuilding once the trace-wide attempt budget is spent', () => {
    const { points } = chamferedStar(12);
    const spent = { attemptsLeft: 0 };
    const untouched = runTraceSteps(
      sharpenChainBendsSteps(points, true, INKED_FIELD, FIELD_WIDTH, undefined, spent),
    );
    expect(untouched.points).toEqual(points);
    expect(untouched.corners.size).toBe(0);

    const partial = { attemptsLeft: 5 };
    const some = runTraceSteps(
      sharpenChainBendsSteps(points, true, INKED_FIELD, FIELD_WIDTH, undefined, partial),
    );
    expect(partial.attemptsLeft).toBe(0);
    expect(some.corners.size).toBeGreaterThan(0);
    expect(some.corners.size).toBeLessThan(24);
  });

  it('scales the trace-wide budget with the working raster above its floor', () => {
    expect(createBendBudget(0).attemptsLeft).toBe(createBendBudget(100_000).attemptsLeft);
    expect(createBendBudget(4_000_000).attemptsLeft).toBe(400_000);
  });
});
