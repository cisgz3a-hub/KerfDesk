// ADR-414: compile flattens cubic and elliptical-arc segments with the fewest
// chords whose true distance from the curve stays within the tolerance.
// These checks measure that distance independently, by dense sampling of the
// exact curve against each emitted chord, never through the flattener's own
// error formula.

import { describe, expect, it } from 'vitest';
import { curveSubpathBounds, flattenCurveSubpath } from './curve-path';
import type { CubicPathSegment, CurveSubpath, PathSegment, Vec2 } from './scene-object';

function cubicAt(from: Vec2, s: CubicPathSegment, t: number): Vec2 {
  const u = 1 - t;
  return {
    x:
      u * u * u * from.x +
      3 * u * u * t * s.control1.x +
      3 * u * t * t * s.control2.x +
      t ** 3 * s.to.x,
    y:
      u * u * u * from.y +
      3 * u * u * t * s.control1.y +
      3 * u * t * t * s.control2.y +
      t ** 3 * s.to.y,
  };
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

type Parametric = (t: number) => Vec2;

const SCAN_STEPS = 20_000;
const ON_CURVE = 1e-9;

/**
 * The parameter of vertex `b`, searched forward from `from`: the first local
 * minimum of the distance to `b` on a fine scan that, refined by ternary
 * search, lies on `b`. Emitted vertices lie on the curve, in order.
 */
function recoverParameter(curve: Parametric, from: number, b: Vec2): number {
  const distance = (t: number): number => Math.hypot(curve(t).x - b.x, curve(t).y - b.y);
  const step = 1 / SCAN_STEPS;
  for (let t = from; t <= 1 + step / 2; t += step) {
    const here = distance(Math.min(t, 1));
    const left = t - step < from ? Infinity : distance(t - step);
    const right = t + step > 1 ? Infinity : distance(t + step);
    if (here > left || here > right) continue;
    let low = Math.max(from, t - step);
    let high = Math.min(1, t + step);
    for (let i = 0; i < 80; i += 1) {
      const m1 = low + (high - low) / 3;
      const m2 = high - (high - low) / 3;
      if (distance(m1) < distance(m2)) high = m2;
      else low = m1;
    }
    if (distance((low + high) / 2) <= ON_CURVE) return (low + high) / 2;
  }
  throw new Error(`vertex ${b.x}, ${b.y} is not on the curve after t=${from}`);
}

/**
 * Chord by chord, the largest distance between each emitted chord and the
 * curve piece it replaces, both directions: 256 samples of the exact piece
 * against the chord segment, and 16 points of the chord against the piece.
 */
function perChordDeviation(curve: Parametric, chords: ReadonlyArray<Vec2>): number {
  let worst = 0;
  let t0 = 0;
  for (let i = 1; i < chords.length; i += 1) {
    const a = chords[i - 1] as Vec2;
    const b = chords[i] as Vec2;
    const t1 = i === chords.length - 1 ? 1 : recoverParameter(curve, t0, b);
    const piece = Array.from({ length: 257 }, (_, k) => curve(t0 + ((t1 - t0) * k) / 256));
    for (const p of piece) worst = Math.max(worst, segmentDistance(p, a, b));
    for (let k = 1; k < 16; k += 1) {
      const q = { x: a.x + ((b.x - a.x) * k) / 16, y: a.y + ((b.y - a.y) * k) / 16 };
      let nearest = Infinity;
      for (let j = 1; j < piece.length; j += 1) {
        nearest = Math.min(nearest, segmentDistance(q, piece[j - 1] as Vec2, piece[j] as Vec2));
      }
      worst = Math.max(worst, nearest);
    }
    t0 = t1;
  }
  return worst;
}

function flattenOne(from: Vec2, segment: PathSegment, toleranceMm: number): Vec2[] {
  const result = flattenCurveSubpath(
    { start: from, segments: [segment], closed: false },
    { toleranceMm },
  );
  if (result.kind !== 'ok') throw new Error('flatten failed');
  return [...result.polyline.points];
}

function cubicCurve(from: Vec2, segment: CubicPathSegment): Parametric {
  return (t) => cubicAt(from, segment, t);
}

// Mulberry32: a fixed seed keeps the property test reproducible.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('chord-optimal curve flattening (ADR-414)', () => {
  it('keeps every chord of random cubics within the tolerance, ends exact', () => {
    const next = random(414);
    const point = (span: number): Vec2 => ({ x: (next() - 0.5) * span, y: (next() - 0.5) * span });
    for (let trial = 0; trial < 300; trial += 1) {
      const span = [1, 10, 100][trial % 3] as number;
      const from = point(span);
      // Every fourth cubic has collinear controls, which may run past its ends.
      const segment: CubicPathSegment =
        trial % 4 === 3
          ? {
              kind: 'cubic',
              control1: { x: from.x + next() * span, y: from.y },
              control2: { x: from.x - next() * span, y: from.y },
              to: { x: from.x + (next() - 0.5) * span, y: from.y },
            }
          : { kind: 'cubic', control1: point(span), control2: point(span), to: point(span) };
      const tolerance = [0.001, 0.025, 0.2][trial % 3] as number;
      const chords = flattenOne(from, segment, tolerance);
      expect(chords[0]).toEqual(from);
      expect(chords.at(-1)).toEqual(segment.to);
      const deviation = perChordDeviation(cubicCurve(from, segment), chords);
      expect(deviation, `trial ${trial}`).toBeLessThanOrEqual(tolerance * (1 + 1e-9) + 1e-12);
    }
  });

  it('follows a cubic that runs past the end of its own chord', () => {
    // Collinear controls outside the ends: every control point is on the
    // chord's line, so the midpoint flatness test accepted one chord from
    // x=0 to x=10 while the curve reaches x=12.8.
    const from = { x: 0, y: 0 };
    const segment: CubicPathSegment = {
      kind: 'cubic',
      control1: { x: 40, y: 0 },
      control2: { x: -30, y: 0 },
      to: { x: 10, y: 0 },
    };
    const chords = flattenOne(from, segment, 0.025);
    expect(Math.max(...chords.map((p) => p.x))).toBeGreaterThan(12.7);
    expect(perChordDeviation(cubicCurve(from, segment), chords)).toBeLessThanOrEqual(0.025);
  });

  it('holds on the dragon Line Art cubic the midpoint test left 0.032 mm off', () => {
    // From the dragon fixture's Line Art trace at 100 mm: local trace pixels,
    // tolerance 0.025 mm over the placement scale (100 mm / 1,254 px).
    const tolerance = 0.025 / (100 / 1254);
    const from = { x: 1099.8344187702764, y: 648.5772436180724 };
    const segment: CubicPathSegment = {
      kind: 'cubic',
      control1: { x: 1099.983473478892, y: 648.8988663560009 },
      control2: { x: 1099.8332480620081, y: 646.1895456928465 },
      to: { x: 1099.8984436204155, y: 647.5813820543387 },
    };
    const chords = flattenOne(from, segment, tolerance);
    expect(perChordDeviation(cubicCurve(from, segment), chords)).toBeLessThanOrEqual(tolerance);
  });

  it('needs the analytic minimum of chords for a quarter circle', () => {
    // Radius 10, tolerance 0.025: a chord over angle a has sagitta
    // 10 (1 - cos(a / 2)), so the fewest chords is ceil((pi/2) / 2 acos(0.9975)) = 12.
    // The cubic quarter-circle is itself within 0.0028 of the circle.
    const k = 0.5522847498 * 10;
    const quarter: CubicPathSegment = {
      kind: 'cubic',
      control1: { x: 10, y: k },
      control2: { x: k, y: 10 },
      to: { x: 0, y: 10 },
    };
    const chords = flattenOne({ x: 10, y: 0 }, quarter, 0.025);
    expect(chords.length - 1).toBeLessThanOrEqual(12);
    const circle: PathSegment = {
      kind: 'elliptical-arc',
      radiusX: 10,
      radiusY: 10,
      rotationDeg: 0,
      largeArc: false,
      sweep: true,
      to: { x: 0, y: 10 },
    };
    expect(flattenOne({ x: 10, y: 0 }, circle, 0.025).length - 1).toBe(
      Math.ceil(Math.PI / 2 / (2 * Math.acos(1 - 0.025 / 10))),
    );
  });

  it('keeps every chord of rotated ellipse arcs within the tolerance, ends exact', () => {
    // Each arc is built from its own centre parametrisation, which the check
    // samples directly; the flattener only sees the SVG endpoint form.
    const next = random(391);
    for (let trial = 0; trial < 120; trial += 1) {
      const radiusX = 0.5 + next() * 40;
      const radiusY = 0.2 + next() * 40;
      const rotationDeg = next() * 360;
      const theta1 = next() * 2 * Math.PI;
      const delta = (next() > 0.5 ? 1 : -1) * (0.05 + next() * 1.95 * Math.PI);
      const center = { x: next() * 20, y: next() * 20 };
      const phi = (rotationDeg * Math.PI) / 180;
      const curve: Parametric = (t) => {
        const theta = theta1 + delta * t;
        const x = radiusX * Math.cos(theta);
        const y = radiusY * Math.sin(theta);
        return {
          x: center.x + x * Math.cos(phi) - y * Math.sin(phi),
          y: center.y + x * Math.sin(phi) + y * Math.cos(phi),
        };
      };
      const from = curve(0);
      const segment: PathSegment = {
        kind: 'elliptical-arc',
        radiusX,
        radiusY,
        rotationDeg,
        largeArc: Math.abs(delta) > Math.PI,
        sweep: delta > 0,
        to: curve(1),
      };
      const tolerance = [0.005, 0.025, 0.1][trial % 3] as number;
      const chords = flattenOne(from, segment, tolerance);
      expect(chords[0]).toEqual(from);
      expect(chords.at(-1)).toEqual(segment.to);
      expect(perChordDeviation(curve, chords), `trial ${trial}`).toBeLessThanOrEqual(
        tolerance * (1 + 1e-9) + 1e-9,
      );
    }
  });

  it('keeps line segments exactly and flattens deterministically', () => {
    const curve: CurveSubpath = {
      start: { x: 0.1, y: 0.2 },
      segments: [
        { kind: 'line', to: { x: 3.3, y: 0.7 } },
        { kind: 'cubic', control1: { x: 5, y: 9 }, control2: { x: 9, y: -4 }, to: { x: 12, y: 2 } },
        { kind: 'line', to: { x: 12, y: 8.123456789 } },
      ],
      closed: true,
    };
    const first = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
    const second = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
    expect(first).toEqual(second);
    if (first.kind !== 'ok') throw new Error('flatten failed');
    const points = first.polyline.points;
    expect(points[0]).toEqual(curve.start);
    expect(points[1]).toEqual({ x: 3.3, y: 0.7 });
    expect(points.at(-2)).toEqual({ x: 12, y: 2 });
    expect(points.at(-1)).toEqual({ x: 12, y: 8.123456789 });
    // Every vertex lies on the curve, so the flattened bounds sit inside the
    // curve's exact bounds.
    const bounds = curveSubpathBounds(curve);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(p.x).toBeLessThanOrEqual(bounds.maxX);
      expect(p.y).toBeGreaterThanOrEqual(bounds.minY);
      expect(p.y).toBeLessThanOrEqual(bounds.maxY);
    }
  });

  it('flattens a zero-length closed cubic loop within the tolerance', () => {
    const from = { x: 0, y: 0 };
    const loop: CubicPathSegment = {
      kind: 'cubic',
      control1: { x: 10, y: 10 },
      control2: { x: -10, y: 10 },
      to: { x: 0, y: 0 },
    };
    const chords = flattenOne(from, loop, 0.025);
    expect(chords.at(-1)).toEqual(loop.to);
    expect(perChordDeviation(cubicCurve(from, loop), chords)).toBeLessThanOrEqual(0.025);
  });

  it('holds on cusps, self-loops, inflections and degenerate cubics', () => {
    const cubic = (c1: Vec2, c2: Vec2, to: Vec2): CubicPathSegment => ({
      kind: 'cubic',
      control1: c1,
      control2: c2,
      to,
    });
    const o = { x: 0, y: 0 };
    const cases: ReadonlyArray<{ name: string; segment: CubicPathSegment; straight?: true }> = [
      // Crossed controls whose derivative vanishes at t = 0.5.
      { name: 'cusp', segment: cubic({ x: 40, y: 40 }, { x: 0, y: 40 }, { x: 40, y: 0 }) },
      { name: 'cusp at the start', segment: cubic(o, { x: 30, y: 40 }, { x: 40, y: 0 }) },
      { name: 'self-loop', segment: cubic({ x: 60, y: 30 }, { x: -30, y: 30 }, { x: 30, y: 0 }) },
      { name: 'inflection', segment: cubic({ x: 30, y: 30 }, { x: 30, y: -30 }, { x: 60, y: 0 }) },
      {
        name: 'double inflection',
        segment: cubic({ x: 30, y: 25 }, { x: -5, y: -20 }, { x: 25, y: 5 }),
      },
      { name: 'point', segment: cubic(o, o, o), straight: true },
      {
        name: 'controls on the ends',
        segment: cubic(o, { x: 17, y: -3 }, { x: 17, y: -3 }),
        straight: true,
      },
      {
        name: 'coincident controls on the chord',
        segment: cubic({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 10 }),
        straight: true,
      },
      {
        name: 'microscopic',
        segment: cubic({ x: 2e-7, y: 1e-7 }, { x: -1e-7, y: 3e-7 }, { x: 1e-6, y: 0 }),
      },
    ];
    for (const { name, segment, straight } of cases) {
      for (const tolerance of [0.001, 0.025]) {
        const chords = flattenOne(o, segment, tolerance);
        expect(chords[0], name).toEqual(o);
        expect(chords.at(-1), name).toEqual(segment.to);
        if (straight) expect(chords.length, name).toBeLessThanOrEqual(2);
        const deviation = perChordDeviation(cubicCurve(o, segment), chords);
        expect(deviation, `${name} at ${tolerance}`).toBeLessThanOrEqual(tolerance * (1 + 1e-9));
        const bounds = curveSubpathBounds({ start: o, segments: [segment], closed: false });
        for (const p of chords) {
          expect(p.x, name).toBeGreaterThanOrEqual(bounds.minX);
          expect(p.x, name).toBeLessThanOrEqual(bounds.maxX);
          expect(p.y, name).toBeGreaterThanOrEqual(bounds.minY);
          expect(p.y, name).toBeLessThanOrEqual(bounds.maxY);
        }
      }
    }
  });
});
