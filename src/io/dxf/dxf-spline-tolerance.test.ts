import { describe, expect, it } from 'vitest';

import type { Vec2 } from '../../core/scene';
import { sampleSpline, type SplineData } from './dxf-spline';

// Fidelity, not structure. The old sampler took spans x 8 steps in PARAMETER
// space regardless of shape, so the distance between the emitted polyline and
// the real curve was whatever the geometry happened to produce. These tests
// measure that distance directly.

function points(spline: SplineData, toleranceMm: number): ReadonlyArray<Vec2> {
  const result = sampleSpline(spline, { toleranceMm });
  if (result.kind !== 'ok') throw new Error(`expected ok, got: ${result.reason}`);
  return result.points;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPolyline(p: Vec2, polyline: ReadonlyArray<Vec2>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < polyline.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, polyline[i - 1] as Vec2, polyline[i] as Vec2));
  }
  return best;
}

// A very tight sampling stands in for the true curve; it is two orders of
// magnitude finer than any tolerance under test.
function maxDeviationFromTruth(spline: SplineData, toleranceMm: number): number {
  const truth = points(spline, 1e-4);
  const approximation = points(spline, toleranceMm);
  let worst = 0;
  for (const p of truth) worst = Math.max(worst, distanceToPolyline(p, approximation));
  return worst;
}

const gentleSweep: SplineData = {
  degree: 3,
  knots: [0, 0, 0, 0, 1, 1, 1, 1],
  controlPoints: [
    { x: 0, y: 0 },
    { x: 160, y: 40 },
    { x: 340, y: 40 },
    { x: 500, y: 0 },
  ],
  weights: [],
  closed: false,
};

const tightHairpin: SplineData = {
  degree: 3,
  knots: [0, 0, 0, 0, 1, 1, 1, 1],
  controlPoints: [
    { x: 0, y: 0 },
    { x: 14, y: 0 },
    { x: 14, y: 2 },
    { x: 0, y: 2 },
  ],
  weights: [],
  closed: false,
};

// Rational quarter circle, radius 50 - the classic NURBS conic, and the case
// where a fixed step size shows most.
const rationalQuarterCircle: SplineData = {
  degree: 2,
  knots: [0, 0, 0, 1, 1, 1],
  controlPoints: [
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 0, y: 50 },
  ],
  weights: [1, Math.SQRT1_2, 1],
  closed: false,
};

const cases: ReadonlyArray<readonly [string, SplineData]> = [
  ['gentle 500mm sweep', gentleSweep],
  ['tight hairpin', tightHairpin],
  ['rational quarter circle', rationalQuarterCircle],
];

describe('sampleSpline respects a chord tolerance', () => {
  for (const [name, spline] of cases) {
    it(`stays within tolerance on a ${name}`, () => {
      for (const tolerance of [0.5, 0.1, 0.025, 0.005]) {
        const deviation = maxDeviationFromTruth(spline, tolerance);
        // Slack covers the reference polyline's own 1e-4 error.
        expect(deviation, `${name} @ ${tolerance}mm`).toBeLessThanOrEqual(tolerance + 1e-3);
      }
    });
  }

  it('spends points where the curvature is', () => {
    // The whole point of adaptive sampling: a tighter tolerance buys more
    // points, and a curvier shape costs more than a flat one at equal tolerance.
    const coarse = points(tightHairpin, 0.5).length;
    const fine = points(tightHairpin, 0.005).length;
    expect(fine).toBeGreaterThan(coarse);

    const straightish: SplineData = {
      ...gentleSweep,
      controlPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0.05 },
        { x: 200, y: 0.05 },
        { x: 300, y: 0 },
      ],
    };
    expect(points(straightish, 0.025).length).toBeLessThan(points(tightHairpin, 0.025).length);
  });

  it('verifies the rational quarter circle against the exact radius', () => {
    // Independent of the sampler: every emitted point must lie on r=50, which
    // is a property of the curve itself rather than of our own approximation.
    for (const p of points(rationalQuarterCircle, 0.025)) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(50, 2);
    }
  });

  it('defaults to the machine curve tolerance when none is given', () => {
    const defaulted = sampleSpline(tightHairpin);
    const explicit = sampleSpline(tightHairpin, { toleranceMm: 0.025 });
    expect(defaulted.kind).toBe('ok');
    expect(explicit.kind).toBe('ok');
    if (defaulted.kind !== 'ok' || explicit.kind !== 'ok') return;
    expect(defaulted.points).toEqual(explicit.points);
  });
});
