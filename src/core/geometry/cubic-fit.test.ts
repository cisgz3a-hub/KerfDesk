import { describe, expect, it } from 'vitest';
import { fitCubicWithTangents, fitCubicsThroughPoints, type CubicBezier } from './cubic-fit';
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

describe('fitCubicWithTangents', () => {
  it('solves only the arm lengths and recovers a cubic from its own samples', () => {
    const source: CubicBezier = {
      p0: { x: 0, y: 0 },
      p1: { x: 3, y: 4 },
      p2: { x: 7, y: 5 },
      p3: { x: 10, y: 0 },
    };
    const samples = Array.from({ length: 41 }, (_, i) => cubicAt(source, i / 40));

    const fit = fitCubicWithTangents(
      samples,
      unit(source.p0, source.p1),
      unit(source.p3, source.p2),
    );

    expect(fit?.p0).toEqual(source.p0);
    expect(fit?.p3).toEqual(source.p3);
    const leaving = unit(fit!.p0, fit!.p1);
    const entering = unit(fit!.p3, fit!.p2);
    expect(leaving.x).toBeCloseTo(0.6, 12);
    expect(leaving.y).toBeCloseTo(0.8, 12);
    expect(entering.x).toBeCloseTo(-3 / Math.hypot(3, 5), 12);
    expect(entering.y).toBeCloseTo(5 / Math.hypot(3, 5), 12);
    for (const point of samples) {
      const nearest = Math.min(
        ...Array.from({ length: 401 }, (_, i) => {
          const q = cubicAt(fit!, i / 400);
          return Math.hypot(q.x - point.x, q.y - point.y);
        }),
      );
      expect(nearest).toBeLessThan(0.02);
    }
    expect(fitCubicWithTangents([source.p0], { x: 1, y: 0 }, { x: -1, y: 0 })).toBeNull();
  });
});

function cubicAt(c: CubicBezier, t: number): Vec2 {
  const m = 1 - t;
  return {
    x: m * m * m * c.p0.x + 3 * m * m * t * c.p1.x + 3 * m * t * t * c.p2.x + t * t * t * c.p3.x,
    y: m * m * m * c.p0.y + 3 * m * m * t * c.p1.y + 3 * m * t * t * c.p2.y + t * t * t * c.p3.y,
  };
}
