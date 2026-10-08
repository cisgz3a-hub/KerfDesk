// Artwork-only arc parameters. Keep the affine image's centre and cosine/sine
// basis: reconstructing a very eccentric ellipse from rounded world endpoints
// can move its centre, or mistake a real out-and-back excursion for a point.
// These immutable parameters belong to transient export geometry, never the
// persisted scene or the shared machine/G-code arc implementation (ADR-431).

import { endpointArc } from '../scene/curve-path';
import type { EllipticalArcPathSegment, Vec2 } from '../scene/scene-object';

export type ArtworkParametricArc = {
  readonly center: Vec2;
  readonly u: Vec2;
  readonly v: Vec2;
  readonly theta1: number;
  readonly delta: number;
};

export type ParametricArtworkSegment = EllipticalArcPathSegment & {
  readonly [ARTWORK_ARC]: ArtworkParametricArc;
};

const ARTWORK_ARC = Symbol('artwork affine arc');
const TAU = 2 * Math.PI;

export function retainedArtworkArc(segment: EllipticalArcPathSegment): ArtworkParametricArc | null {
  return ARTWORK_ARC in segment ? (segment as ParametricArtworkSegment)[ARTWORK_ARC] : null;
}

/** A JSON key cannot impersonate this nonserializable, immutable export marker. */
export function retainArtworkArc(
  segment: EllipticalArcPathSegment,
  arc: ArtworkParametricArc,
): EllipticalArcPathSegment {
  const immutable = Object.freeze({
    ...arc,
    center: Object.freeze({ ...arc.center }),
    u: Object.freeze({ ...arc.u }),
    v: Object.freeze({ ...arc.v }),
  });
  return { ...segment, [ARTWORK_ARC]: immutable } as ParametricArtworkSegment;
}

/** SVG endpoint conversion in the source frame, without squared tiny radii. */
export function artworkArcParameters(
  from: Vec2,
  segment: EllipticalArcPathSegment,
): ArtworkParametricArc | null {
  const retained = retainedArtworkArc(segment);
  if (retained !== null) return retained;
  return endpointArtworkArcParameters(from, segment);
}

function endpointArtworkArcParameters(
  from: Vec2,
  segment: EllipticalArcPathSegment,
): ArtworkParametricArc | null {
  if (from.x === segment.to.x && from.y === segment.to.y) return null;
  let rx = Math.abs(segment.radiusX);
  let ry = Math.abs(segment.radiusY);
  if (!(rx > 0) || !(ry > 0)) return null;
  const phi = (segment.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - segment.to.x) / 2;
  const dy = (from.y - segment.to.y) / 2;
  const x = cos * dx + sin * dy;
  const y = -sin * dx + cos * dy;
  const correction = Math.hypot(x / rx, y / ry);
  if (correction > 1) {
    rx *= correction;
    ry *= correction;
  }
  const nx = x / rx;
  const ny = y / ry;
  const length = Math.hypot(nx, ny);
  const offset = correction >= 1 ? 0 : Math.sqrt(Math.max(0, 1 - length * length));
  const sign = segment.largeArc === segment.sweep ? -1 : 1;
  const unit = length === 0 ? { x: 0, y: 0 } : { x: nx / length, y: ny / length };
  const cx = sign * rx * unit.y * offset;
  const cy = -sign * ry * unit.x * offset;
  const small = 2 * Math.asin(Math.min(1, length));
  return {
    center: {
      x: cos * cx - sin * cy + (from.x + segment.to.x) / 2,
      y: sin * cx + cos * cy + (from.y + segment.to.y) / 2,
    },
    u: { x: cos * rx, y: sin * rx },
    v: { x: -sin * ry, y: cos * ry },
    theta1: Math.atan2(ny - cy / ry, nx - cx / rx),
    delta: (segment.sweep ? 1 : -1) * (segment.largeArc ? TAU - small : small),
  };
}

/** SVG's exact coincident-endpoint rule, without the machine helper's epsilon. */
export function artworkSvgEncodingError(from: Vec2, segment: EllipticalArcPathSegment): number {
  const retained = retainedArtworkArc(segment);
  if (retained === null) return 0;
  const encoded = endpointArtworkArcParameters(from, segment);
  return encoded === null ? Infinity : artworkArcParameterError(retained, encoded);
}

export function artworkArcEncodingRoundoff(from: Vec2, segment: EllipticalArcPathSegment): number {
  return (
    32 *
    Number.EPSILON *
    Math.max(
      1,
      Math.abs(from.x),
      Math.abs(from.y),
      Math.abs(segment.to.x),
      Math.abs(segment.to.y),
      segment.radiusX,
      segment.radiusY,
    )
  );
}

export function artworkArcPoint(arc: ArtworkParametricArc, theta: number): Vec2 {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: arc.center.x + arc.u.x * cos + arc.v.x * sin,
    y: arc.center.y + arc.u.y * cos + arc.v.y * sin,
  };
}

/** Endpoints and all axis extrema, ordered in the original traversal. */
export function artworkArcExtrema(arc: ArtworkParametricArc): number[] {
  const fractions = new Set([0, 1]);
  for (const axis of ['x', 'y'] as const) {
    if (arc.u[axis] === 0 && arc.v[axis] === 0) continue;
    const root = Math.atan2(arc.v[axis], arc.u[axis]);
    for (const angle of [root, root + Math.PI]) {
      const offset = ((((angle - arc.theta1) * Math.sign(arc.delta)) % TAU) + TAU) % TAU;
      if (offset > 0 && offset < Math.abs(arc.delta)) {
        fractions.add(offset / Math.abs(arc.delta));
      }
    }
  }
  return [...fractions].sort((a, b) => a - b);
}

/** The existing quarter-turn cubic representation used by PDF and EPS. */
export function artworkArcCubics(
  from: Vec2,
  to: Vec2,
  arc: ArtworkParametricArc,
): ReadonlyArray<{ readonly control1: Vec2; readonly control2: Vec2; readonly to: Vec2 }> {
  const turns = Math.abs(arc.delta) / (Math.PI / 2);
  const count = Math.max(1, Math.ceil(turns - 4 * Number.EPSILON * Math.max(1, turns)));
  const out: { control1: Vec2; control2: Vec2; to: Vec2 }[] = [];
  let current = from;
  for (let index = 0; index < count; index += 1) {
    const a = arc.theta1 + (arc.delta * index) / count;
    const b = arc.theta1 + (arc.delta * (index + 1)) / count;
    const end = index === count - 1 ? to : artworkArcPoint(arc, b);
    const arm = (4 / 3) * Math.tan((b - a) / 4);
    const derivative = (angle: number): Vec2 => ({
      x: -arc.u.x * Math.sin(angle) + arc.v.x * Math.cos(angle),
      y: -arc.u.y * Math.sin(angle) + arc.v.y * Math.cos(angle),
    });
    const da = derivative(a);
    const db = derivative(b);
    out.push({
      control1: { x: current.x + arm * da.x, y: current.y + arm * da.y },
      control2: { x: end.x - arm * db.x, y: end.y - arm * db.y },
      to: end,
    });
    current = end;
  }
  return out;
}

/**
 * Chords with a world-space Hausdorff bound. A <=90 degree ellipse piece is
 * a positive-weight rational quadratic, inside the triangle of its endpoints
 * and tangent intersection. Distance to the chord segment is convex, so the
 * control's distance bounds every curve point. Continuity of projection onto
 * the chord supplies the reverse bound. Split at every turnaround first.
 * Exhausted budget or an unrepresentable refinement is an explicit failure.
 */
export function flattenArtworkArc(
  from: Vec2,
  to: Vec2,
  arc: ArtworkParametricArc,
  tolerance: number,
  budget: number,
): Vec2[] | null {
  if (![from, to, arc.center, arc.u, arc.v].every(finitePoint)) return null;
  if (![arc.theta1, arc.delta].every(Number.isFinite)) return null;
  const out: Vec2[] = [];
  const extrema = artworkArcExtrema(arc);
  let current = from;
  for (let index = 1; index < extrema.length; index += 1) {
    const start = extrema[index - 1] as number;
    const end = extrema[index] as number;
    const count = Math.max(1, Math.ceil((Math.abs(arc.delta) * (end - start)) / (Math.PI / 2)));
    for (let part = 0; part < count; part += 1) {
      const a = arc.theta1 + arc.delta * (start + ((end - start) * part) / count);
      const b = arc.theta1 + arc.delta * (start + ((end - start) * (part + 1)) / count);
      const last = index === extrema.length - 1 && part === count - 1;
      const next = last ? to : artworkArcPoint(arc, b);
      if (!subdivide(arc, a, b, current, next, tolerance, budget, out)) return null;
      current = next;
    }
  }
  return out;
}

function subdivide(
  arc: ArtworkParametricArc,
  a: number,
  b: number,
  from: Vec2,
  to: Vec2,
  tolerance: number,
  budget: number,
  out: Vec2[],
): boolean {
  if (out.length >= budget) return false;
  const middle = (a + b) / 2;
  const scale = 1 / Math.cos((b - a) / 2);
  const control = {
    x: arc.center.x + scale * (arc.u.x * Math.cos(middle) + arc.v.x * Math.sin(middle)),
    y: arc.center.y + scale * (arc.u.y * Math.cos(middle) + arc.v.y * Math.sin(middle)),
  };
  if (!finitePoint(control)) return false;
  if (pointSegmentDistance(control, from, to) <= tolerance) {
    out.push(to);
    return true;
  }
  if (middle === a || middle === b) return false;
  const point = artworkArcPoint(arc, middle);
  return (
    subdivide(arc, a, middle, from, point, tolerance, budget, out) &&
    subdivide(arc, middle, b, point, to, tolerance, budget, out)
  );
}

/** Conservative parameter-wise difference from a world endpoint reconstruction. */
export function artworkArcReconstructionError(
  from: Vec2,
  segment: EllipticalArcPathSegment,
): number {
  const retained = artworkArcParameters(from, segment);
  if (retained === null) return 0;
  const reconstructed = endpointArc(from, segment);
  if (reconstructed === null) return Infinity;
  const cos = Math.cos(reconstructed.rotationRad);
  const sin = Math.sin(reconstructed.rotationRad);
  const candidate: ArtworkParametricArc = {
    center: reconstructed.center,
    u: { x: reconstructed.radiusX * cos, y: reconstructed.radiusX * sin },
    v: { x: -reconstructed.radiusY * sin, y: reconstructed.radiusY * cos },
    theta1: reconstructed.theta1,
    delta: reconstructed.delta,
  };
  return artworkArcParameterError(retained, candidate);
}

/** A world-space bound between two arcs at the same traversal fraction. */
export function artworkArcParameterError(
  retained: ArtworkParametricArc,
  candidate: ArtworkParametricArc,
): number {
  const basisAtStart = (arc: ArtworkParametricArc): readonly [Vec2, Vec2] => {
    const c = Math.cos(arc.theta1);
    const s = Math.sin(arc.theta1);
    const sign = Math.sign(arc.delta);
    return [
      { x: arc.u.x * c + arc.v.x * s, y: arc.u.y * c + arc.v.y * s },
      { x: sign * (-arc.u.x * s + arc.v.x * c), y: sign * (-arc.u.y * s + arc.v.y * c) },
    ];
  };
  const [u, v] = basisAtStart(retained);
  const [otherU, otherV] = basisAtStart(candidate);
  const phaseError = Math.abs(Math.abs(retained.delta) - Math.abs(candidate.delta));
  return (
    distance(retained.center, candidate.center) +
    distance(u, otherU) +
    distance(v, otherV) +
    phaseError * (Math.hypot(otherU.x, otherU.y) + Math.hypot(otherV.x, otherV.y))
  );
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function finitePoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const length = distance(a, b);
  if (length === 0) return distance(p, a);
  const dx = (b.x - a.x) / length;
  const dy = (b.y - a.y) / length;
  const along = Math.max(0, Math.min(length, (p.x - a.x) * dx + (p.y - a.y) * dy));
  return Math.hypot(p.x - a.x - along * dx, p.y - a.y - along * dy);
}
