// Behaviour tests for the centripetal Catmull-Rom output resampler.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import { fitSmoothCurve } from './curve-fit';

const NO_CORNERS: ReadonlySet<Vec2> = new Set();

function turnAt(prev: Vec2, at: Vec2, next: Vec2): number {
  const a1 = Math.atan2(at.y - prev.y, at.x - prev.x);
  const a2 = Math.atan2(next.y - at.y, next.x - at.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

describe('fitSmoothCurve', () => {
  it('keeps straight collinear points straight (no bulging)', () => {
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ];
    const out = fitSmoothCurve(points, false, NO_CORNERS, 2);
    for (const p of out) expect(Math.abs(p.y)).toBeLessThan(1e-6);
  });

  it('emits a corner vertex exactly and keeps its legs straight', () => {
    const apex: Vec2 = { x: 10, y: 10 };
    const points: Vec2[] = [
      { x: 0, y: 10 },
      { x: 5, y: 10 },
      apex,
      { x: 10, y: 5 },
      { x: 10, y: 0 },
    ];
    const out = fitSmoothCurve(points, false, new Set([apex]), 3);
    // The apex object survives (reference identity) for downstream pinning.
    expect(out).toContain(apex);
    // The turn concentrates AT the apex: some sample must turn ~90deg.
    let maxTurn = 0;
    for (let i = 1; i + 1 < out.length; i += 1) {
      maxTurn = Math.max(maxTurn, turnAt(out[i - 1] as Vec2, out[i] as Vec2, out[i + 1] as Vec2));
    }
    expect(maxTurn).toBeGreaterThan((70 * Math.PI) / 180);
  });

  it('distributes curvature evenly on a sampled circle (smoother than the input polygon)', () => {
    const radius = 40;
    const control: Vec2[] = [];
    const steps = 16; // coarse polygon input, like DP output
    for (let i = 0; i < steps; i += 1) {
      const a = (i / steps) * 2 * Math.PI;
      control.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
    }
    const out = fitSmoothCurve(control, true, NO_CORNERS, 3);
    const worstTurn = (pts: ReadonlyArray<Vec2>): number => {
      const ring = [...pts, pts[0] as Vec2, pts[1] as Vec2];
      let worst = 0;
      for (let i = 1; i + 1 < ring.length; i += 1) {
        worst = Math.max(worst, turnAt(ring[i - 1] as Vec2, ring[i] as Vec2, ring[i + 1] as Vec2));
      }
      return worst;
    };
    // Every resampled vertex turns less than a raw polygon vertex did.
    expect(worstTurn(out)).toBeLessThan(worstTurn(control));
    // Samples stay ON the circle (bounded deviation — no overshoot).
    for (const p of out) {
      expect(Math.abs(Math.hypot(p.x, p.y) - radius)).toBeLessThan(0.6);
    }
  });

  it('does not duplicate the seam vertex of a smooth closed ring', () => {
    const radius = 20;
    const control: Vec2[] = [];
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * 2 * Math.PI;
      control.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
    }
    const out = fitSmoothCurve(control, true, NO_CORNERS, 2);
    const first = out[0] as Vec2;
    const last = out.at(-1) as Vec2;
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThan(1e-6);
  });
});
