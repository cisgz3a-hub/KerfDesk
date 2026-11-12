// Copy Along Path (ADR-498 decision 4): the guide's true direction where a
// copy sits. The walk the copies are spaced along is the guide flattened to
// within 0.025 mm, so its edges are chords: on a curve each chord leans off
// the curve by up to half the angle it spans (5.7° on a 5 mm circle). This
// keeps, for every walk edge, the canonical segment it was flattened from, so
// a copy on a cubic or an arc turns with the curve's tangent at its point,
// while a copy on a straight segment, or on a guide with no canonical curves,
// keeps the edge's own direction. Real corners therefore stay corners.

import type {
  CubicPathSegment,
  CurveSubpath,
  EllipticalArcPathSegment,
  Transform,
  Vec2,
} from '../scene/scene-object';
import { endpointArc, flattenCurveSubpath, pointOnArc } from '../scene/curve-path';
import { applyTransform } from '../scene/transform';

/** The canonical curve behind a guide's walk, in world millimetres. */
export type GuideCurve = {
  /** For walk edge `i` (point `i - 1` to point `i`), its index in `pieces`, or -1 when the edge is straight. */
  readonly edgePiece: ReadonlyArray<number>;
  readonly pieces: ReadonlyArray<CurvePiece>;
};

/** One cubic or arc segment of the guide, on t in [0, 1]. */
type CurvePiece = {
  readonly point: (t: number) => Vec2;
  /** Direction of travel at t, not normalised. */
  readonly derivative: (t: number) => Vec2;
};

// Coarse samples that bracket a point's nearest curve parameter, then golden
// section steps that narrow the bracket to well under a nanometre.
const SAMPLES = 32;
const REFINE_STEPS = 48;
const GOLDEN = (Math.sqrt(5) - 1) / 2;
// A derivative this short is a cubic's coincident control point: look a hair
// inside the segment for its direction instead.
const STILL = 1e-12;
const NUDGE = 1e-6;

/**
 * Map each edge of the flattened guide back to its canonical segment.
 * `toleranceMm` is the local flattening tolerance the guide's polyline was
 * made with and `pointCount` that polyline's length; when re-flattening does
 * not land on the same count the map cannot be trusted, and null leaves the
 * guide on its chords.
 */
export function guideCurve(
  curve: CurveSubpath,
  transform: Transform,
  toleranceMm: number,
  pointCount: number,
): GuideCurve | null {
  const edgePiece: number[] = [-1];
  const pieces: CurvePiece[] = [];
  let current = curve.start;
  for (const segment of curve.segments) {
    const flat = flattenCurveSubpath(
      { start: current, segments: [segment], closed: false },
      { toleranceMm, segmentBudget: Number.MAX_SAFE_INTEGER },
    );
    if (flat.kind !== 'ok') return null;
    const piece =
      segment.kind === 'cubic'
        ? cubicPiece(current, segment, transform)
        : segment.kind === 'elliptical-arc'
          ? arcPiece(current, segment, transform)
          : null;
    const index = piece === null ? -1 : pieces.push(piece) - 1;
    for (let edge = 0; edge < flat.segmentCount; edge += 1) edgePiece.push(index);
    current = segment.to;
  }
  if (edgePiece.length !== pointCount || pieces.length === 0) return null;
  return { edgePiece, pieces };
}

/**
 * The unit tangent of the canonical segment behind walk edge `edge`, at the
 * curve point nearest `point`; null when that edge is straight (the caller
 * uses the edge itself).
 */
export function curveTangent(curve: GuideCurve, edge: number, point: Vec2): Vec2 | null {
  const piece = curve.pieces[curve.edgePiece[edge] ?? -1];
  if (piece === undefined) return null;
  const t = nearestParameter(piece, point);
  let direction = piece.derivative(t);
  if (Math.hypot(direction.x, direction.y) <= STILL)
    direction = piece.derivative(t < 0.5 ? t + NUDGE : t - NUDGE);
  const length = Math.hypot(direction.x, direction.y);
  return length > STILL ? { x: direction.x / length, y: direction.y / length } : null;
}

function nearestParameter(piece: CurvePiece, point: Vec2): number {
  const distance = (t: number): number => {
    const at = piece.point(t);
    return (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
  };
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample <= SAMPLES; sample += 1) {
    const value = distance(sample / SAMPLES);
    if (value < bestDistance) {
      best = sample;
      bestDistance = value;
    }
  }
  let low = Math.max(0, (best - 1) / SAMPLES);
  let high = Math.min(1, (best + 1) / SAMPLES);
  let a = high - GOLDEN * (high - low);
  let b = low + GOLDEN * (high - low);
  let distanceA = distance(a);
  let distanceB = distance(b);
  for (let step = 0; step < REFINE_STEPS; step += 1) {
    if (distanceA <= distanceB) {
      high = b;
      b = a;
      distanceB = distanceA;
      a = high - GOLDEN * (high - low);
      distanceA = distance(a);
    } else {
      low = a;
      a = b;
      distanceA = distanceB;
      b = low + GOLDEN * (high - low);
      distanceB = distance(b);
    }
  }
  // The ends themselves: a copy on a segment's first or last point.
  const middle = (low + high) / 2;
  const candidates = [middle, 0, 1];
  return candidates.reduce((pick, t) => (distance(t) < distance(pick) ? t : pick), middle);
}

// An affine map takes a cubic to the cubic of its mapped control points.
function cubicPiece(from: Vec2, segment: CubicPathSegment, transform: Transform): CurvePiece {
  const p0 = applyTransform(from, transform);
  const p1 = applyTransform(segment.control1, transform);
  const p2 = applyTransform(segment.control2, transform);
  const p3 = applyTransform(segment.to, transform);
  return {
    point: (t) => {
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      return {
        x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
        y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
      };
    },
    derivative: (t) => {
      const u = 1 - t;
      const w0 = 3 * u * u;
      const w1 = 6 * u * t;
      const w2 = 3 * t * t;
      return {
        x: w0 * (p1.x - p0.x) + w1 * (p2.x - p1.x) + w2 * (p3.x - p2.x),
        y: w0 * (p1.y - p0.y) + w1 * (p2.y - p1.y) + w2 * (p3.y - p2.y),
      };
    },
  };
}

// An arc is walked in its own centre parametrisation and mapped to the world;
// its direction goes through the transform's linear part. A zero-radius or
// zero-length arc is drawn as its chord, so it has no curve.
function arcPiece(
  from: Vec2,
  segment: EllipticalArcPathSegment,
  transform: Transform,
): CurvePiece | null {
  const arc = endpointArc(from, segment);
  if (arc === null) return null;
  const linear: Transform = { ...transform, x: 0, y: 0 };
  const cosPhi = Math.cos(arc.rotationRad);
  const sinPhi = Math.sin(arc.rotationRad);
  return {
    point: (t) => applyTransform(pointOnArc(arc, arc.theta1 + arc.delta * t), transform),
    derivative: (t) => {
      const theta = arc.theta1 + arc.delta * t;
      const dx = -arc.radiusX * Math.sin(theta) * arc.delta;
      const dy = arc.radiusY * Math.cos(theta) * arc.delta;
      return applyTransform({ x: dx * cosPhi - dy * sinPhi, y: dx * sinPhi + dy * cosPhi }, linear);
    },
  };
}
