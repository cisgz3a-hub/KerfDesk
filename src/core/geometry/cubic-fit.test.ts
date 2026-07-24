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
