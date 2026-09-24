import { describe, expect, it } from 'vitest';
import { fitCubicsThroughPoints, type CubicBezier } from './cubic-fit';
import type { Vec2 } from '../scene';

// A CCW circle sampled as a closed, cornerless ring — the shape a traced disc /
// letter-O bowl reduces to. `startAngle` rotates where index 0 (the seam) lands.
function circle(radius: number, count: number, startAngle = 0): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const theta = startAngle + (2 * Math.PI * i) / count;
    points.push({ x: 100 + radius * Math.cos(theta), y: 100 + radius * Math.sin(theta) });
  }
  return points;
}

function unit(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
}

// Angle (degrees) between the direction the loop LEAVES the seam (first cubic's
// start tangent) and the direction it ARRIVES at the seam (last cubic's end
// tangent). Zero = G1-continuous seam; non-zero = a cusp at index 0.
function seamTangentBreakDeg(cubics: ReadonlyArray<CubicBezier>): number {
  const first = cubics[0];
  const last = cubics[cubics.length - 1];
  if (first === undefined || last === undefined) return 0;
  const leaving = unit(first.p0, first.p1);
  const arriving = unit(last.p2, last.p3);
  const dot = Math.max(-1, Math.min(1, leaving.x * arriving.x + leaving.y * arriving.y));
  return (Math.acos(dot) * 180) / Math.PI;
}

describe('fitCubicsThroughPoints — closed cornerless seam', () => {
  it('seams a traced circle G1 (no cusp at index 0)', () => {
    const noCorners = new Set<Vec2>();
    for (const start of [0, 0.37, 1.1, 2.9]) {
      const points = circle(50, 64, start);
      const cubics = fitCubicsThroughPoints(points, true, noCorners, 0.4);
      expect(cubics.length).toBeGreaterThan(1); // a full circle splits into arcs
      // The seam tangent must be continuous; the one-sided chord seam left a
      // several-degree kink on every traced disc.
      expect(seamTangentBreakDeg(cubics)).toBeLessThan(1);
    }
  });
});

// Largest distance from any point on the fitted cubics to the open chain they
// replace, sampled densely enough to catch a loop between two data points.
function maxDeviationFromChain(cubics: ReadonlyArray<CubicBezier>, chain: ReadonlyArray<Vec2>) {
  const toSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  let worst = 0;
  for (const c of cubics) {
    for (let s = 0; s <= 64; s += 1) {
      const t = s / 64;
      const m = 1 - t;
      const q = {
        x:
          m * m * m * c.p0.x + 3 * t * m * m * c.p1.x + 3 * t * t * m * c.p2.x + t * t * t * c.p3.x,
        y:
          m * m * m * c.p0.y + 3 * t * m * m * c.p1.y + 3 * t * t * m * c.p2.y + t * t * t * c.p3.y,
      };
      let nearest = Infinity;
      for (let i = 0; i + 1 < chain.length; i += 1) {
        nearest = Math.min(nearest, toSegment(q, chain[i] as Vec2, chain[i + 1] as Vec2));
      }
      worst = Math.max(worst, nearest);
    }
  }
  return worst;
}

describe('fitCubicsThroughPoints — control-arm ordering', () => {
  it('keeps a cubic with one interior point from looping away from its chord', () => {
    // A corner-bounded run from the dragon fixture's Line Art trace. The corner
    // rebuild leaves widely spaced points at its start, so one split has a
    // single interior point. Least squares then passes through that point
    // exactly with arms many times the chord: zero error at the data points,
    // but the curve loops about 19 px off the run between them.
    const run: Vec2[] = [
      [12.42, 32.13],
      [14.452, 23.146],
      [15.733, 17.769],
      [16.163, 16.179],
      [16.143, 16.024],
      [16.023, 15.534],
      [15.887, 14.61],
      [15.7, 13.714],
      [15.45, 12.96],
      [15.187, 12.278],
      [14.996, 11.757],
      [14.847, 11.342],
      [14.433, 10.302],
      [13.372, 7.636],
      [11.708, 3.421],
    ].map(([x, y]) => ({ x: x as number, y: y as number }));
    const cubics = fitCubicsThroughPoints(run, false, new Set<Vec2>(), 0.35);
    expect(maxDeviationFromChain(cubics, run)).toBeLessThan(1);
  });
});
