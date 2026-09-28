import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath } from '../../scene/curve-path';
import {
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type Transform,
  type Vec2,
} from '../../scene/scene-object';
import { applyTransform } from '../../scene/transform';
import { optimizeContour } from './optimize-contour';
import { outlineDeviationMm } from './outline-deviation';
import {
  DEFAULT_SHAPE_OPTIMIZE_OPTIONS,
  type ShapeOptimizeOptions,
} from './shape-optimize-options';

// A deterministic pseudo-random wobble so the tests do not depend on Math.random.
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

function polylineCurve(points: ReadonlyArray<Vec2>, closed: boolean): CurveSubpath {
  const ring = closed ? [...points, points[0] as Vec2] : points;
  return {
    start: ring[0] as Vec2,
    segments: ring.slice(1).map((to) => ({ kind: 'line' as const, to })),
    closed,
  };
}

function noisyCircle(radius: number, count: number, amplitude: number, seed = 1): Vec2[] {
  const random = noise(seed);
  return Array.from({ length: count }, (_, k) => {
    const angle = (2 * Math.PI * k) / count;
    const r = radius + amplitude * random();
    return { x: 50 + r * Math.cos(angle), y: 40 + r * Math.sin(angle) };
  });
}

function worldPoints(curve: CurveSubpath, transform: Transform = IDENTITY_TRANSFORM): Vec2[] {
  const flat = flattenCurveSubpath(curve, { toleranceMm: 0.0005 });
  if (flat.kind !== 'ok') throw new Error('flatten failed');
  return flat.polyline.points.map((point) => applyTransform(point, transform));
}

// `mean` is the radius of the circle with the same area, so it does not depend
// on where the outline happens to have points.
function radii(points: ReadonlyArray<Vec2>, center: Vec2): { mean: number; spread: number } {
  const values = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  let area = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length] as Vec2;
    area += (point.x - center.x) * (next.y - center.y) - (next.x - center.x) * (point.y - center.y);
  });
  const mean = Math.sqrt(Math.abs(area) / 2 / Math.PI);
  return { mean, spread: Math.max(...values) - Math.min(...values) };
}

const options = (patch: Partial<ShapeOptimizeOptions> = {}): ShapeOptimizeOptions => ({
  ...DEFAULT_SHAPE_OPTIMIZE_OPTIONS,
  ...patch,
});

describe('optimizeContour smoothing', () => {
  it('smooths a noisy circle round without shrinking it, and keeps it closed', () => {
    const source = polylineCurve(noisyCircle(5, 600, 0.08), true);
    const smoothed = optimizeContour(
      source,
      IDENTITY_TRANSFORM,
      options({ smoothingMm: 0.3, fit: false }),
    );
    const out = radii(worldPoints(smoothed.curve), { x: 50, y: 40 });
    // The +-0.04 mm noise averages out round the true radius.
    expect(Math.abs(out.mean - 5)).toBeLessThan(0.003);
    expect(out.spread).toBeLessThan(0.03);
    const fitted = optimizeContour(source, IDENTITY_TRANSFORM, options({ smoothingMm: 0.3 }));
    expect(fitted.changed).toBe(true);
    expect(fitted.curve.closed).toBe(true);
    expect(fitted.curve.segments.at(-1)?.to).toEqual(fitted.curve.start);
    expect(fitted.segments).toBeLessThan(20);
    expect(radii(worldPoints(fitted.curve), { x: 50, y: 40 }).spread).toBeLessThan(0.12);
  });

  it('does not shrink a curve even when smoothing reaches a fifth of its radius', () => {
    // Plain Gaussian smoothing would pull this circle in by sigma^2 / 2R = 0.1 mm.
    const circle = noisyCircle(5, 2000, 0);
    const result = optimizeContour(
      polylineCurve(circle, true),
      IDENTITY_TRANSFORM,
      options({ smoothingMm: 1, fit: false }),
    );
    // What is left is the fourth-order remainder, sigma^4 / 4R^3 = 0.002 mm,
    // and up to 0.002 mm from the lines that stand in for Fit.
    const out = radii(worldPoints(result.curve), { x: 50, y: 40 });
    expect(Math.abs(out.mean - 5)).toBeLessThan(0.005);
    expect(result.movedMm).toBeLessThan(0.005);
  });

  it('keeps corners sharp and exactly in place while smoothing the sides', () => {
    const random = noise(7);
    const square: Vec2[] = [];
    const corners = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    corners.forEach((corner, side) => {
      const next = corners[(side + 1) % 4] as Vec2;
      square.push(corner);
      for (let k = 1; k < 100; k += 1) {
        const t = k / 100;
        const nx = -(next.y - corner.y) / 20;
        const ny = (next.x - corner.x) / 20;
        const wobble = 0.05 * random();
        square.push({
          x: corner.x + (next.x - corner.x) * t + nx * wobble,
          y: corner.y + (next.y - corner.y) * t + ny * wobble,
        });
      }
    });
    const result = optimizeContour(polylineCurve(square, true), IDENTITY_TRANSFORM, options());
    const nodes = [result.curve.start, ...result.curve.segments.map((segment) => segment.to)];
    for (const corner of corners) {
      expect(nodes.some((node) => node.x === corner.x && node.y === corner.y)).toBe(true);
    }
    // The sides come out as four straight lines meeting at the exact corners.
    expect(result.segments).toBe(4);
    expect(result.curve.segments.every((segment) => segment.kind === 'line')).toBe(true);
    expect(result.movedMm).toBeLessThan(0.05);
  });

  it('pins the ends of an open path and leaves a straight line alone', () => {
    const random = noise(3);
    const wave = Array.from({ length: 400 }, (_, k) => ({
      x: k * 0.05,
      y: 3 * Math.sin(k * 0.01) + 0.03 * random(),
    }));
    const result = optimizeContour(polylineCurve(wave, false), IDENTITY_TRANSFORM, options());
    expect(result.curve.closed).toBe(false);
    expect(result.curve.start).toEqual(wave[0]);
    expect(result.curve.segments.at(-1)?.to).toEqual(wave[wave.length - 1]);
    const straight = polylineCurve(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
    );
    expect(optimizeContour(straight, IDENTITY_TRANSFORM, options()).changed).toBe(false);
  });

  it('treats a pixel staircase as noise, not as corners', () => {
    const steps: Vec2[] = [];
    for (let k = 0; k < 60; k += 1) {
      steps.push({ x: k * 0.1, y: k * 0.1 }, { x: (k + 1) * 0.1, y: k * 0.1 });
    }
    steps.push({ x: 6, y: 6 });
    const result = optimizeContour(polylineCurve(steps, false), IDENTITY_TRANSFORM, options());
    expect(result.segments).toBe(1);
    expect(result.curve.segments[0]?.kind).toBe('line');
  });
});

describe('optimizeContour fitting', () => {
  it('fits within the tolerance of the source when smoothing is off', () => {
    const random = noise(11);
    const blob = Array.from({ length: 900 }, (_, k) => {
      const angle = (2 * Math.PI * k) / 900;
      const r = 8 + 1.5 * Math.sin(3 * angle) + 0.4 * Math.cos(7 * angle) + 0.002 * random();
      return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    });
    const source = polylineCurve(blob, true);
    for (const tolerance of [0.01, 0.05, 0.2]) {
      const result = optimizeContour(
        source,
        IDENTITY_TRANSFORM,
        options({ smooth: false, fitToleranceMm: tolerance }),
      );
      expect(result.changed).toBe(true);
      expect(result.segments).toBeLessThan(900);
      const moved = outlineDeviationMm(blob, true, worldPoints(result.curve), true);
      expect(moved).toBeLessThanOrEqual(tolerance);
      expect(result.movedMm).toBeLessThanOrEqual(tolerance);
    }
  });

  it('fits with lines and arcs only when asked, arcs on a circle', () => {
    const circle = noisyCircle(10, 720, 0);
    const result = optimizeContour(
      polylineCurve(circle, true),
      IDENTITY_TRANSFORM,
      options({ smooth: false, fitWith: 'lines-arcs' }),
    );
    expect(result.curve.segments.every((segment) => segment.kind !== 'cubic')).toBe(true);
    expect(result.curve.segments.some((segment) => segment.kind === 'elliptical-arc')).toBe(true);
    expect(result.segments).toBeLessThanOrEqual(4);
    expect(result.movedMm).toBeLessThanOrEqual(0.05);
  });

  it('works in world millimetres on a scaled, rotated and mirrored object', () => {
    const transform: Transform = {
      x: 30,
      y: -5,
      scaleX: 2.5,
      scaleY: 0.8,
      rotationDeg: 33,
      mirrorX: true,
      mirrorY: false,
    };
    const blob = Array.from({ length: 500 }, (_, k) => {
      const angle = (2 * Math.PI * k) / 500;
      const r = 4 + 0.8 * Math.sin(2 * angle);
      return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    });
    const source = polylineCurve(blob, true);
    for (const fitWith of ['lines-arcs', 'lines-arcs-curves'] as const) {
      const result = optimizeContour(source, transform, options({ smooth: false, fitWith }));
      const before = blob.map((point) => applyTransform(point, transform));
      const moved = outlineDeviationMm(before, true, worldPoints(result.curve, transform), true);
      expect(moved).toBeLessThanOrEqual(0.05);
    }
  });

  it('does not make a path bigger when only fitting', () => {
    const k = 0.5522847498 * 5;
    const circle: CurveSubpath = {
      start: { x: 5, y: 0 },
      closed: true,
      segments: [
        { kind: 'cubic', control1: { x: 5, y: k }, control2: { x: k, y: 5 }, to: { x: 0, y: 5 } },
        {
          kind: 'cubic',
          control1: { x: -k, y: 5 },
          control2: { x: -5, y: k },
          to: { x: -5, y: 0 },
        },
        {
          kind: 'cubic',
          control1: { x: -5, y: -k },
          control2: { x: -k, y: -5 },
          to: { x: 0, y: -5 },
        },
        { kind: 'cubic', control1: { x: k, y: -5 }, control2: { x: 5, y: -k }, to: { x: 5, y: 0 } },
      ],
    };
    const result = optimizeContour(circle, IDENTITY_TRANSFORM, options({ smooth: false }));
    expect(result.segments).toBeLessThanOrEqual(4);
  });
});
