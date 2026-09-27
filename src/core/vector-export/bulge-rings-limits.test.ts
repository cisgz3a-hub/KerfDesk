import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath } from '../scene/curve-path';
import type { CurveSubpath, PathSegment, Vec2 } from '../scene/scene-object';
import { chordCurveEdges } from './bulge-chords';
import {
  curveToBulgeRing,
  DEFAULT_DXF_CURVE_TOLERANCE_MM,
  MIN_ARC_FIT_TOLERANCE_MM,
} from './bulge-rings';
import { hausdorff, sampleBulges } from './bulge-sampling.test-support';

// Tolerance floor, radius limits and bad input of the DXF bulge writer
// (ADR-452 review): whatever the fit cannot do better falls back to ADR-431's
// chords, which hold any tolerance.

const KAPPA = 0.5522847498307936;

function source(curve: CurveSubpath): Vec2[] {
  const result = flattenCurveSubpath(curve, { toleranceMm: 1e-5 });
  if (result.kind !== 'ok') throw new Error('flatten failed');
  return [...result.polyline.points];
}

/** A closed four-cubic ellipse with semi-axes rx, ry about the origin. */
function cubicEllipse(rx: number, ry: number): CurveSubpath {
  const at = (q: number): Vec2 => ({
    x: rx * Math.cos((q * Math.PI) / 2),
    y: ry * Math.sin((q * Math.PI) / 2),
  });
  const tangent = (q: number): Vec2 => ({
    x: -rx * Math.sin((q * Math.PI) / 2) * KAPPA,
    y: ry * Math.cos((q * Math.PI) / 2) * KAPPA,
  });
  const segments: PathSegment[] = [];
  for (let q = 0; q < 4; q += 1) {
    const a = at(q);
    const b = at(q + 1);
    const ta = tangent(q);
    const tb = tangent(q + 1);
    segments.push({
      kind: 'cubic',
      control1: { x: a.x + ta.x, y: a.y + ta.y },
      control2: { x: b.x - tb.x, y: b.y - tb.y },
      to: b,
    });
  }
  return { start: at(0), segments, closed: true };
}

/** A closed ellipse of four elliptical arcs with semi-axes rx, ry. */
function arcEllipse(rx: number, ry: number): CurveSubpath {
  const ends = [
    { x: 0, y: ry },
    { x: -rx, y: 0 },
    { x: 0, y: -ry },
    { x: rx, y: 0 },
  ];
  return {
    start: { x: rx, y: 0 },
    closed: true,
    segments: ends.map((to) => ({
      kind: 'elliptical-arc' as const,
      radiusX: rx,
      radiusY: ry,
      rotationDeg: 0,
      largeArc: false,
      sweep: true,
      to,
    })),
  };
}

function oneCubic(c1: Vec2, c2: Vec2, to: Vec2): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    closed: false,
    segments: [{ kind: 'cubic', control1: c1, control2: c2, to }],
  };
}

const sCurve = oneCubic({ x: 30, y: -25 }, { x: -10, y: 45 }, { x: 25, y: 20 });
const ellipse = cubicEllipse(20, 10);

function chordVertexCount(curve: CurveSubpath, toleranceMm: number): number {
  return 1 + chordCurveEdges(curve.start, curve.segments, toleranceMm).length;
}

describe('DXF bulge writer limits (ADR-452)', () => {
  it.each([0.0005, 0.001, 0.002, 0.003, MIN_ARC_FIT_TOLERANCE_MM])(
    'holds a tight tolerance of %s mm on an S-curve and an ellipse',
    (tolerance) => {
      for (const curve of [sCurve, ellipse]) {
        const ring = curveToBulgeRing(curve, tolerance);
        const drawn = sampleBulges(ring.vertices, ring.closed);
        expect(hausdorff(source(curve), drawn)).toBeLessThanOrEqual(tolerance);
      }
    },
    60_000,
  );

  it('never writes more vertices than the chord writer', () => {
    const curves = [
      sCurve,
      ellipse,
      cubicEllipse(2500, 2500),
      cubicEllipse(2000, 1500),
      cubicEllipse(0.05, 0.05),
      arcEllipse(2000, 1500),
      arcEllipse(20, 10),
    ];
    for (const tolerance of [0.002, 0.003, MIN_ARC_FIT_TOLERANCE_MM, 0.005, 0.01]) {
      for (const curve of curves) {
        const ring = curveToBulgeRing(curve, tolerance);
        expect(ring.vertices.length).toBeLessThanOrEqual(chordVertexCount(curve, tolerance));
      }
    }
    // Arcs still win where the fitter reaches: well under a third of the chords.
    expect(curveToBulgeRing(ellipse, 0.01).vertices.length * 3).toBeLessThan(
      chordVertexCount(ellipse, 0.01),
    );
  }, 60_000);

  it('uses the default tolerance for a non-finite one', () => {
    const expected = curveToBulgeRing(ellipse, DEFAULT_DXF_CURVE_TOLERANCE_MM);
    expect(curveToBulgeRing(ellipse, Number.NaN)).toEqual(expected);
    expect(curveToBulgeRing(ellipse, Number.POSITIVE_INFINITY)).toEqual(expected);
  });

  it('refuses non-finite curve coordinates instead of writing wrong geometry', () => {
    const bad = [
      oneCubic({ x: Number.NaN, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }),
      oneCubic({ x: Number.POSITIVE_INFINITY, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }),
      oneCubic({ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 10, y: Number.NaN }),
      {
        start: { x: 0, y: 0 },
        closed: false,
        segments: [
          {
            kind: 'elliptical-arc' as const,
            radiusX: Number.NaN,
            radiusY: 4,
            rotationDeg: 0,
            largeArc: false,
            sweep: true,
            to: { x: 8, y: 0 },
          },
        ],
      },
    ];
    for (const curve of bad) {
      expect(() => curveToBulgeRing(curve, 0.01)).toThrow('non-finite');
    }
  });
});
