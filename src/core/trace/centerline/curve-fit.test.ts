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

  // Signed perpendicular offset of q from the infinite line through a->b,
  // positive on the left of a->b. Mirrors the cap's own metric.
  const perpOffset = (q: Vec2, a: Vec2, b: Vec2): number => {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len = Math.hypot(vx, vy);
    if (len < 1e-9) return Math.hypot(q.x - a.x, q.y - a.y);
    return ((q.x - a.x) * vy - (q.y - a.y) * vx) / len;
  };

  it('caps serif-foot overshoot: mid-foot sample must not bow below the chord beyond the cap', () => {
    // The real HOUSE H left-foot bottom, taken from the verifier pass: a flat
    // foot chord p1->p2 with SHALLOW risers (p0/p1 approach ≈20°, p2/p3 ≈22°,
    // both far below the 60° corner pin, so the spline flows through them just
    // like the live edge pipeline). Centripetal Catmull-Rom bows the mid-foot
    // sample DOWN into empty paper — with the resample on it reaches
    // (505.9, 655.1), ≈0.85px below the chord (≈y654.25). That is the "smile".
    const p0: Vec2 = { x: 485, y: 651 };
    const p1: Vec2 = { x: 493.3, y: 654.1 };
    const p2: Vec2 = { x: 518.5, y: 654.4 };
    const p3: Vec2 = { x: 527, y: 651 };
    const points: Vec2[] = [p0, p1, p2, p3];
    const cap = 0.45;
    // Below the chord is the −perp side (chord runs left→right, so paper below
    // is negative perp offset). No sample on the foot may sink more than `cap`.
    const out = fitSmoothCurve(points, false, NO_CORNERS, 3, cap);
    let worstBelow = 0;
    for (const q of out) worstBelow = Math.min(worstBelow, perpOffset(q, p1, p2));
    expect(-worstBelow).toBeLessThanOrEqual(cap + 1e-6);
    // And it genuinely overshoots without the cap (guards the fixture is real):
    // ≈0.85px > 0.45, so the mechanism-1 cap must bind on this exact sample.
    const uncapped = fitSmoothCurve(points, false, NO_CORNERS, 3);
    let worstUncapped = 0;
    for (const q of uncapped) worstUncapped = Math.min(worstUncapped, perpOffset(q, p1, p2));
    expect(-worstUncapped).toBeGreaterThan(cap);
  });

  it('preserves legitimate sub-cap arc curvature: cap does not disturb a smooth circle', () => {
    // A gently-sampled arc's spline deviation from each p1->p2 chord stays well
    // under ε (a 40px-radius 16-gon's centripetal samples deviate ≲0.03px), so
    // an ε-tied cap must be a no-op here: the capped curve must equal the
    // uncapped curve to floating-point tolerance, and must still leave the
    // input polygon (samples off their control vertices) — never collapse to
    // the straight chords (the "fixing by flattening" failure).
    const radius = 40;
    const control: Vec2[] = [];
    // 32 steps → chord sagitta r(1−cos(π/32)) ≈ 0.19px, comfortably under the
    // 0.45 cap, matching what an ε=0.45 Douglas-Peucker pass would leave (its
    // guarantee: every simplified chord lies within ε of the dense arc).
    const steps = 32;
    for (let i = 0; i < steps; i += 1) {
      const a = (i / steps) * 2 * Math.PI;
      control.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
    }
    const uncapped = fitSmoothCurve(control, true, NO_CORNERS, 3);
    const capped = fitSmoothCurve(control, true, NO_CORNERS, 3, 0.45);
    expect(capped.length).toBe(uncapped.length);
    let maxShift = 0;
    for (let i = 0; i < capped.length; i += 1) {
      const c = capped[i] as Vec2;
      const u = uncapped[i] as Vec2;
      maxShift = Math.max(maxShift, Math.hypot(c.x - u.x, c.y - u.y));
    }
    // The cap leaves every legitimate arc sample untouched (so the smoothed
    // arc keeps its full shape — no flattening).
    expect(maxShift).toBeLessThan(1e-9);
    // And it is still a resampled curve, not collapsed to the input polygon:
    // interior samples were added between control vertices.
    expect(capped.length).toBeGreaterThan(control.length);
  });

  it('keeps a closed ring with exactly ONE corner (teardrop) instead of collapsing it', () => {
    // Regression: a single-corner closed chain used to split into a run from
    // the corner to itself — zero steps, one point — which the closed-ring
    // seam dedupe then popped to an EMPTY output. Real inputs hit this: a
    // traced letter-O counter whose ring carries one detected corner.
    const corner: Vec2 = { x: 20, y: 0 };
    const ring: Vec2[] = [corner];
    const samples = 16;
    for (let i = 1; i < samples; i += 1) {
      const angle = (i / samples) * 2 * Math.PI;
      ring.push({ x: 20 * Math.cos(angle), y: 20 * Math.sin(angle) });
    }
    const out = fitSmoothCurve(ring, true, new Set([corner]), 2);
    // The full ring survives: at least the control vertices, corner included
    // exactly (same object), and the loop is not degenerate.
    expect(out.length).toBeGreaterThanOrEqual(ring.length);
    expect(out).toContain(corner);
  });
});
