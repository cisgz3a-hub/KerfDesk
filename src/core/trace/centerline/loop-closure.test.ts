import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import {
  decideLoopClosure,
  closePolylineLoops,
  closeRingEndpoints,
  LOOP_TOUCH_GAP_PX,
} from './loop-closure';

// Edge-mode reach: join knob 5, aligned factor 3.
const EDGE_OPTIONS = { touchGapPx: LOOP_TOUCH_GAP_PX, cornerGapPx: 5, alignedGapPx: 15 };
// Centerline strict mode: everything collapses to the touch tier.
const STRICT_OPTIONS = {
  touchGapPx: LOOP_TOUCH_GAP_PX,
  cornerGapPx: LOOP_TOUCH_GAP_PX,
  alignedGapPx: LOOP_TOUCH_GAP_PX,
};

// Square perimeter from (2,4) down the left edge, around, ending at (4,2) on
// the top edge — the 2.8px gap spans the (2,2) corner, so the end tangents
// disagree by 90° and only corner-tier closure can see the loop.
function cornerBrokenSquare(): Vec2[] {
  const points: Vec2[] = [];
  for (let y = 4; y <= 20; y += 1) points.push({ x: 2, y });
  for (let x = 3; x <= 20; x += 1) points.push({ x, y: 20 });
  for (let y = 19; y >= 2; y -= 1) points.push({ x: 20, y });
  for (let x = 19; x >= 4; x -= 1) points.push({ x, y: 2 });
  return points;
}

// Half ring: ends 20px apart across the opening — a drawn C, not a loop.
function halfRing(): Vec2[] {
  const points: Vec2[] = [];
  for (let deg = -90; deg <= 90; deg += 5) {
    const a = (deg * Math.PI) / 180;
    points.push({ x: 20 + 10 * Math.cos(a), y: 20 + 10 * Math.sin(a) });
  }
  return points;
}

// A "6"-shaped stroke: the bowl's end stops ~4px from the stem's START, but
// the start tangent leaves DOWNWARD, away from the closing chord — closing
// end-to-start would slash across the stem. Must stay open (the weld stage
// may T-join the bowl onto the stem instead). The gap sits above the
// tangent-trust distance so the forwardness gate is what decides.
function sixShapedStroke(): Vec2[] {
  const points: Vec2[] = [];
  for (let y = 10; y <= 18; y += 1) points.push({ x: 10, y });
  points.push({ x: 17, y: 18 }, { x: 17, y: 13 }, { x: 10.5, y: 13.9 });
  return points;
}

// Ring broken mid-curve: end tangents continue across the chord (aligned).
// Steps by 2° so the last sample lands exactly on 360° for even gaps.
function alignedBrokenRing(gapDeg: number): Vec2[] {
  const points: Vec2[] = [];
  for (let deg = gapDeg; deg <= 360; deg += 2) {
    const a = (deg * Math.PI) / 180;
    points.push({ x: 40 + 20 * Math.cos(a), y: 40 + 20 * Math.sin(a) });
  }
  return points;
}

describe('decideLoopClosure', () => {
  it('closes a loop whose ends meet at a drawn corner (letter outlines)', () => {
    const decision = decideLoopClosure(cornerBrokenSquare(), EDGE_OPTIONS);
    expect(decision).toEqual({ kind: 'close', dropLastPoint: false });
  });

  it('closes a ring broken mid-curve via the aligned tier', () => {
    const decision = decideLoopClosure(alignedBrokenRing(30), EDGE_OPTIONS);
    expect(decision).toEqual({ kind: 'close', dropLastPoint: false });
  });

  it('closes touching ends and drops the duplicate end point', () => {
    const ring = alignedBrokenRing(2);
    expect(decideLoopClosure(ring, EDGE_OPTIONS)).toEqual({
      kind: 'close',
      dropLastPoint: true,
    });
  });

  it('leaves a drawn C-arc open (gap large next to the loop)', () => {
    expect(decideLoopClosure(halfRing(), EDGE_OPTIONS)).toEqual({ kind: 'open' });
  });

  // Below the tangent-trust distance the weld stage may have kinked the very
  // end segments, so receding-LOOKING tangents must not veto an obvious
  // loop: this is the sixShapedStroke geometry shrunk until its gap is under
  // 3px, where the ink is almost certainly a broken loop.
  it('closes a sub-3px gap even when end tangents look receding', () => {
    const points: Vec2[] = [];
    for (let y = 10; y <= 17; y += 1) points.push({ x: 10, y });
    points.push({ x: 14.5, y: 17 }, { x: 14.5, y: 12.6 }, { x: 10.4, y: 12.4 });
    expect(decideLoopClosure(points, EDGE_OPTIONS)).toEqual({
      kind: 'close',
      dropLastPoint: false,
    });
  });

  it('leaves a self-overlapping "6" stroke open (closing would cross the stem)', () => {
    expect(decideLoopClosure(sixShapedStroke(), EDGE_OPTIONS)).toEqual({ kind: 'open' });
  });

  it('keeps strict centerline semantics: corner meetings do not close', () => {
    expect(decideLoopClosure(cornerBrokenSquare(), STRICT_OPTIONS)).toEqual({ kind: 'open' });
  });
});

describe('closeRingEndpoints', () => {
  it('appends the start point to a closed ring whose ends sit a gap apart', () => {
    const ring: Polyline = {
      closed: true,
      // Ends 3px apart — the corner-tier closure signature.
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 3, y: 0 },
      ],
    };
    const [out] = closeRingEndpoints([ring]);
    expect(out?.points).toHaveLength(5);
    expect(out?.points.at(-1)).toEqual({ x: 0, y: 0 });
    expect(out?.closed).toBe(true);
  });

  it('leaves an already-coincident ring untouched (no duplicate seam)', () => {
    const ring: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
      ],
    };
    const [out] = closeRingEndpoints([ring]);
    expect(out?.points).toHaveLength(4);
  });

  it('never touches open polylines', () => {
    const open: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 9, y: 1 },
      ],
    };
    const [out] = closeRingEndpoints([open]);
    expect(out?.points).toHaveLength(3);
    expect(out?.closed).toBe(false);
  });
});

describe('closePolylineLoops', () => {
  it('closes only the almost-closed open polylines and keeps the rest', () => {
    const result = closePolylineLoops(
      [
        { points: cornerBrokenSquare(), closed: false },
        { points: halfRing(), closed: false },
        {
          points: [
            { x: 0, y: 0 },
            { x: 9, y: 0 },
            { x: 9, y: 9 },
            { x: 0, y: 9 },
          ],
          closed: true,
        },
      ],
      EDGE_OPTIONS,
    );
    expect(result.map((polyline) => polyline.closed)).toEqual([true, false, true]);
    expect(result[0]?.points).toHaveLength(cornerBrokenSquare().length);
  });
});
