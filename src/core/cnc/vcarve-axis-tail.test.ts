import { describe, expect, it } from 'vitest';
import { buildOffsetLadder } from '../geometry/offset-ladder';
import type { Polyline } from '../scene';
import { vcarveAxisTail } from './vcarve-axis-tail';

// A W-shaped carve instead of a V is what this module exists to prevent: the
// measured defect was a 1 mm stroke carving two 0.25 mm grooves with an uncut
// ridge between them, because the δ ladder stopped a whole δ short of the
// medial axis. These tests pin the bracket contract and the convergence.

// The bisection stops one emission quantum wide, and every emitted inset is
// reported one offset-grid quantum shallower so it stays certified geometry
// rather than clipper rounding. Two quanta is the tightest honest bound.
const CONVERGENCE_TOLERANCE_MM = 0.002;

function bar(widthMm: number, lengthMm: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: widthMm, y: 0 },
      { x: widthMm, y: lengthMm },
      { x: 0, y: lengthMm },
    ],
  };
}

// Walk the real δ ladder so the bracket handed to the tail is the one the
// compiler would actually produce, not a hand-picked pair.
function ladderBracket(contours: ReadonlyArray<Polyline>, deltaMm: number) {
  const ladder = buildOffsetLadder(contours, 512, (step) => (step + 1) * deltaMm);
  return {
    lastInsetMm: ladder.rings.length * deltaMm,
    failedInsetMm: (ladder.rings.length + 1) * deltaMm,
  };
}

describe('vcarveAxisTail', () => {
  it('drives the deepest inset to the stroke half-width the δ ladder missed', () => {
    // 1 mm bar: true inradius 0.5. At δ = 0.25 the ladder's last ring is 0.25 —
    // half the depth the artwork asks for.
    const contours = [bar(1, 12)];
    const bracket = ladderBracket(contours, 0.25);
    expect(bracket.lastInsetMm).toBeCloseTo(0.25, 10);

    const tail = vcarveAxisTail(contours, bracket.lastInsetMm, bracket.failedInsetMm);

    expect(tail.offsetFailed).toBe(false);
    const deepest = tail.rings[tail.rings.length - 1];
    expect(deepest).toBeDefined();
    // Within two quanta of the medial axis, from 0.25 mm short.
    expect(0.5 - (deepest?.insetMm ?? 0)).toBeLessThanOrEqual(CONVERGENCE_TOLERANCE_MM);
  });

  it('closes the far larger gap left by the default auto pitch', () => {
    // 3 mm bar, δ = 0.75 (auto for a 6 mm bit): the ladder produces NO ring at
    // all beyond 0.75, leaving 0.75 mm of the groove uncut at the centre.
    const contours = [bar(3, 12)];
    const bracket = ladderBracket(contours, 0.75);

    const tail = vcarveAxisTail(contours, bracket.lastInsetMm, bracket.failedInsetMm);

    const deepest = tail.rings[tail.rings.length - 1];
    expect(1.5 - (deepest?.insetMm ?? 0)).toBeLessThanOrEqual(CONVERGENCE_TOLERANCE_MM);
  });

  it('emits only the deepest probe, and it is a real offset', () => {
    // The shallower bisection probes cut nothing the deepest ring misses, so
    // emitting them would be pure travel.
    const contours = [bar(1, 12)];
    const tail = vcarveAxisTail(contours, 0.25, 0.5);

    expect(tail.rings).toHaveLength(1);
    expect(tail.rings[0]?.polylines.length).toBeGreaterThan(0);
    expect(tail.rings[0]?.insetMm).toBeGreaterThan(0.25);
  });

  it('never returns a ring at or beyond the failed inset', () => {
    const contours = [bar(1, 12)];
    const tail = vcarveAxisTail(contours, 0.25, 0.5);
    for (const ring of tail.rings) expect(ring.insetMm).toBeLessThan(0.5);
  });

  it('stops once the bracket is below the emission quantum', () => {
    const contours = [bar(1, 12)];
    const tail = vcarveAxisTail(contours, 0.4995, 0.5);
    expect(tail.rings).toEqual([]);
    expect(tail.offsetFailed).toBe(false);
  });

  it('treats a non-bracket as nothing to refine', () => {
    const contours = [bar(1, 12)];
    expect(vcarveAxisTail(contours, 0.5, 0.5).rings).toEqual([]);
    expect(vcarveAxisTail(contours, 0.5, 0.25).rings).toEqual([]);
    expect(vcarveAxisTail(contours, Number.NaN, 0.5).rings).toEqual([]);
    expect(vcarveAxisTail(contours, 0.25, Number.POSITIVE_INFINITY).rings).toEqual([]);
    expect(vcarveAxisTail([], 0.25, 0.5).rings).toEqual([]);
  });

  it('is deterministic', () => {
    const contours = [bar(1, 12)];
    const a = vcarveAxisTail(contours, 0.25, 0.5);
    const b = vcarveAxisTail(contours, 0.25, 0.5);
    expect(a.rings.map((r) => r.insetMm)).toEqual(b.rings.map((r) => r.insetMm));
  });
});
