import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../core/scene';
import {
  arcToCubics,
  DEFAULT_FLATNESS_MM,
  flattenArc,
  flattenCubic,
  flattenQuadratic,
  type Cubic,
} from './flatten-curves';

describe('flattenCubic', () => {
  it('emits just the endpoint for a flat curve (all 4 points collinear)', () => {
    const out: Vec2[] = [];
    flattenCubic(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      DEFAULT_FLATNESS_MM,
      out,
    );
    // Flat already → single endpoint
    expect(out).toEqual([{ x: 30, y: 0 }]);
  });

  it('subdivides a curved Bezier into many segments', () => {
    const out: Vec2[] = [];
    flattenCubic(
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      DEFAULT_FLATNESS_MM,
      out,
    );
    // S-curve with significant deviation → must be many segments
    expect(out.length).toBeGreaterThan(20);
    // Last point must equal the end
    expect(out[out.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('respects the tolerance: looser tolerance → fewer segments', () => {
    const tight: Vec2[] = [];
    const loose: Vec2[] = [];
    const args = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ] as const;
    flattenCubic(args[0], args[1], args[2], args[3], 0.1, tight);
    flattenCubic(args[0], args[1], args[2], args[3], 5, loose);
    expect(loose.length).toBeLessThan(tight.length);
  });
});

describe('flattenQuadratic', () => {
  it('produces a polyline starting from p0 + p2', () => {
    const out: Vec2[] = [];
    flattenQuadratic({ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }, DEFAULT_FLATNESS_MM, out);
    // Last point must equal the end
    expect(out[out.length - 1]).toEqual({ x: 100, y: 0 });
    // Curve through (50,25) approximately → some segments above y=0
    const aboveAxis = out.some((p) => p.y > 5);
    expect(aboveAxis).toBe(true);
  });
});

describe('flattenArc', () => {
  it('emits the endpoint when rx or ry is zero (degenerate)', () => {
    const out: Vec2[] = [];
    flattenArc(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { rx: 0, ry: 5, xAxisRotationDeg: 0, largeArc: false, sweep: true },
      DEFAULT_FLATNESS_MM,
      out,
    );
    expect(out).toEqual([{ x: 10, y: 10 }]);
  });

  it('produces a curved polyline from a quarter-turn arc', () => {
    const out: Vec2[] = [];
    // Quarter circle from (10,0) to (0,10) with rx=ry=10, sweep=true
    flattenArc(
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { rx: 10, ry: 10, xAxisRotationDeg: 0, largeArc: false, sweep: true },
      DEFAULT_FLATNESS_MM,
      out,
    );
    expect(out.length).toBeGreaterThan(5);
    expect(out[out.length - 1]?.x).toBeCloseTo(0);
    expect(out[out.length - 1]?.y).toBeCloseTo(10);
    // Every intermediate point should lie on the unit circle r=10.
    for (const p of out) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 1);
    }
  });
});

type Ellipse = {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly rotationDeg: number;
};

describe('arcToCubics', () => {
  it('keeps a rotated elliptical arc within 0.03 mm of its ellipse', () => {
    // Three 90° cubics. Maisonobe's arm length left each midpoint 0.196% of
    // the radius inside the arc; the (4/3)·tan(Δ/4) arm strays at most
    // 0.027% of the major radius (ADR-159 Amendment 2).
    const ellipse: Ellipse = { cx: 12, cy: -7, rx: 100, ry: 40, rotationDeg: 30 };
    const cubics = arcToCubics(ellipsePoint(ellipse, 20), ellipsePoint(ellipse, 290), 100, 40, {
      rx: 100,
      ry: 40,
      xAxisRotationDeg: 30,
      largeArc: true,
      sweep: true,
    });
    expect(cubics).toHaveLength(3);
    const distances = cubics.flatMap((c) => samples(c).map((p) => distanceToEllipse(p, ellipse)));
    expect(Math.max(...distances)).toBeLessThan(0.03);
  });

  it('ends exactly at the authored endpoints, with arms along the arc tangents', () => {
    // Radius 50 is too small for this chord, so SVG scales it up and centres
    // the circle on the chord. The old centre sat ~1e-8 of the radius off the
    // chord, tilting the arms, and its acos sweep ended 0.09 µm short.
    const start = { x: 0.1, y: 0.2 };
    const end = { x: 300.7, y: 120.3 };
    const centre = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const cubics = arcToCubics(start, end, 50, 50, {
      rx: 50,
      ry: 50,
      xAxisRotationDeg: 0,
      largeArc: false,
      sweep: true,
    });
    expect(cubics).toHaveLength(2);
    expect(cubics[0]?.p0).toEqual(start);
    expect(cubics[1]?.p0).toEqual(cubics[0]?.p3);
    expect(cubics[1]?.p3).toEqual(end);
    for (const c of cubics) {
      // A tangent arm is square to the radius at its end.
      expect(cosineBetween(c.p1, c.p0, centre)).toBeCloseTo(0, 12);
      expect(cosineBetween(c.p2, c.p3, centre)).toBeCloseTo(0, 12);
    }
  });
});

function samples(c: Cubic): Vec2[] {
  return Array.from({ length: 65 }, (_, i) => {
    const t = i / 64;
    const u = 1 - t;
    const [a, b, d, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return {
      x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
      y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
    };
  });
}

function ellipsePoint(e: Ellipse, eccentricDeg: number): Vec2 {
  const t = (eccentricDeg * Math.PI) / 180;
  const phi = (e.rotationDeg * Math.PI) / 180;
  const [x, y] = [e.rx * Math.cos(t), e.ry * Math.sin(t)];
  return {
    x: e.cx + x * Math.cos(phi) - y * Math.sin(phi),
    y: e.cy + x * Math.sin(phi) + y * Math.cos(phi),
  };
}

// Nearest-point distance, by Newton on the eccentric angle seeded with the
// point's own angle, which is close for points near the ellipse.
function distanceToEllipse(p: Vec2, e: Ellipse): number {
  const phi = (e.rotationDeg * Math.PI) / 180;
  const [dx, dy] = [p.x - e.cx, p.y - e.cy];
  const x = dx * Math.cos(phi) + dy * Math.sin(phi);
  const y = -dx * Math.sin(phi) + dy * Math.cos(phi);
  const k = e.ry * e.ry - e.rx * e.rx;
  let t = Math.atan2(e.rx * y, e.ry * x);
  for (let i = 0; i < 20; i += 1) {
    const slope = k * Math.sin(t) * Math.cos(t) + e.rx * x * Math.sin(t) - e.ry * y * Math.cos(t);
    const curvature = k * Math.cos(2 * t) + e.rx * x * Math.cos(t) + e.ry * y * Math.sin(t);
    t -= slope / curvature;
  }
  return Math.hypot(e.rx * Math.cos(t) - x, e.ry * Math.sin(t) - y);
}

function cosineBetween(armTip: Vec2, anchor: Vec2, centre: Vec2): number {
  const arm = { x: armTip.x - anchor.x, y: armTip.y - anchor.y };
  const radius = { x: anchor.x - centre.x, y: anchor.y - centre.y };
  return (
    (arm.x * radius.x + arm.y * radius.y) /
    (Math.hypot(arm.x, arm.y) * Math.hypot(radius.x, radius.y))
  );
}
