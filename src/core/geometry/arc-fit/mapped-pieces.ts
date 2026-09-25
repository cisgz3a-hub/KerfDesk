// A canonical subpath mapped into machine millimetres piece by piece, and the
// dense sampling of each piece the fitter checks against (ADR-407).
//
// Lines and cubics map exactly under the affine placement (map the control
// points). An elliptical arc is flattened in its local frame at the source
// sample error and its points mapped; its tangents come from the circle
// through each sample and its neighbours, which is second-order accurate.
// Cubics are sampled uniformly in t with enough steps that each chord stays
// within ARC_FIT_SOURCE_SAMPLE_ERROR_MM of the curve: for a parametric curve a
// chord over dt deviates at most max|B''| dt^2 / 8, and a cubic's |B''| peaks
// at an end, 6 max(|P0 - 2P1 + P2|, |P1 - 2P2 + P3|).

import { flattenCurveSubpath, type CurveSubpath, type PathSegment, type Vec2 } from '../../scene';
import { ARC_FIT_BREAK_SPACING_MM, ARC_FIT_SOURCE_SAMPLE_ERROR_MM } from './arc-fit-limits';
import { unit } from './arc-primitives';
import type { SmoothRun } from './fit-runs';

type PieceEnds = {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly startTangent: Vec2;
  readonly endTangent: Vec2;
};

export type MappedPiece =
  | (PieceEnds & { readonly kind: 'line' })
  | (PieceEnds & { readonly kind: 'cubic'; readonly control1: Vec2; readonly control2: Vec2 })
  | (PieceEnds & { readonly kind: 'dense'; readonly points: ReadonlyArray<Vec2> });

export type ArcFitPlacement = {
  /** Local subpath coordinates to machine millimetres (affine). */
  readonly map: (point: Vec2) => Vec2;
  /** Largest absolute axis scale of the placement, for local tolerances. */
  readonly largestScale: number;
};

const SAME_POINT_MM = 1e-9;
const MAX_CUBIC_SAMPLES = 4096;

export function mapCurveSubpath(curve: CurveSubpath, placement: ArcFitPlacement): MappedPiece[] {
  const pieces: MappedPiece[] = [];
  let from = curve.start;
  let mappedFrom = placement.map(from);
  const mappedStart = mappedFrom;
  for (const segment of curve.segments) {
    const piece = mapSegment(from, mappedFrom, segment, placement);
    if (piece !== null) pieces.push(piece);
    from = segment.to;
    mappedFrom = piece?.end ?? mappedFrom;
  }
  if (curve.closed && !samePoint(mappedFrom, mappedStart)) {
    const closing = linePiece(mappedFrom, mappedStart);
    if (closing !== null) pieces.push(closing);
  }
  return pieces;
}

function mapSegment(
  from: Vec2,
  mappedFrom: Vec2,
  segment: PathSegment,
  placement: ArcFitPlacement,
): MappedPiece | null {
  const end = placement.map(segment.to);
  if (segment.kind === 'line') return linePiece(mappedFrom, end);
  if (segment.kind === 'cubic') {
    const control1 = placement.map(segment.control1);
    const control2 = placement.map(segment.control2);
    const startTangent = firstDirection(mappedFrom, [control1, control2, end]);
    const endTangent = firstDirection(end, [control2, control1, mappedFrom], -1);
    if (startTangent === null || endTangent === null) return null;
    return { kind: 'cubic', start: mappedFrom, control1, control2, end, startTangent, endTangent };
  }
  const scale = placement.largestScale > 0 ? placement.largestScale : 1;
  const flattened = flattenCurveSubpath(
    { start: from, segments: [segment], closed: false },
    { toleranceMm: ARC_FIT_SOURCE_SAMPLE_ERROR_MM / scale },
  );
  if (flattened.kind !== 'ok') return null;
  const points = distinct([mappedFrom, ...flattened.polyline.points.slice(1).map(placement.map)]);
  if (points.length < 2) return null;
  points[points.length - 1] = end;
  const tangents = circleTangents(points);
  return {
    kind: 'dense',
    points,
    start: mappedFrom,
    end,
    startTangent: tangents[0] as Vec2,
    endTangent: tangents[tangents.length - 1] as Vec2,
  };
}

function linePiece(start: Vec2, end: Vec2): MappedPiece | null {
  if (samePoint(start, end)) return null;
  const tangent = unit(end.x - start.x, end.y - start.y);
  return { kind: 'line', start, end, startTangent: tangent, endTangent: tangent };
}

type PieceSamples = Pick<SmoothRun, 'points' | 'tangentsIn' | 'tangentsOut'>;

export function sampleMappedPiece(piece: MappedPiece): PieceSamples {
  if (piece.kind === 'dense') {
    const tangents = circleTangents(piece.points);
    return { points: piece.points, tangentsIn: tangents, tangentsOut: tangents };
  }
  if (piece.kind === 'line') {
    const count = Math.max(
      1,
      Math.ceil(distance(piece.start, piece.end) / ARC_FIT_BREAK_SPACING_MM),
    );
    const points = Array.from({ length: count + 1 }, (_, index) =>
      index === count ? piece.end : lerp(piece.start, piece.end, index / count),
    );
    const tangents = points.map(() => piece.startTangent);
    return { points, tangentsIn: tangents, tangentsOut: tangents };
  }
  return sampleCubic(piece);
}

function sampleCubic(piece: Extract<MappedPiece, { kind: 'cubic' }>): PieceSamples {
  const { start: p0, control1: p1, control2: p2, end: p3 } = piece;
  const secondDerivative =
    6 *
    Math.max(
      Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y),
      Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y),
    );
  const polygon = distance(p0, p1) + distance(p1, p2) + distance(p2, p3);
  const count = Math.min(
    MAX_CUBIC_SAMPLES,
    Math.max(
      1,
      Math.ceil(Math.sqrt(secondDerivative / (8 * ARC_FIT_SOURCE_SAMPLE_ERROR_MM))),
      Math.ceil(polygon / ARC_FIT_BREAK_SPACING_MM),
    ),
  );
  const points: Vec2[] = [];
  const tangents: Vec2[] = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    points.push(index === 0 ? p0 : index === count ? p3 : cubicPoint(piece, t));
    const derivative = cubicDerivative(piece, t);
    tangents.push(
      index === 0
        ? piece.startTangent
        : index === count
          ? piece.endTangent
          : Math.hypot(derivative.x, derivative.y) > 0
            ? unit(derivative.x, derivative.y)
            : piece.startTangent,
    );
  }
  return { points, tangentsIn: tangents, tangentsOut: tangents };
}

function cubicPoint(piece: Extract<MappedPiece, { kind: 'cubic' }>, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * piece.start.x + b * piece.control1.x + c * piece.control2.x + d * piece.end.x,
    y: a * piece.start.y + b * piece.control1.y + c * piece.control2.y + d * piece.end.y,
  };
}

function cubicDerivative(piece: Extract<MappedPiece, { kind: 'cubic' }>, t: number): Vec2 {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  const { start: p0, control1: p1, control2: p2, end: p3 } = piece;
  return {
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
  };
}

// Tangent at each sample of the circle through it and its two neighbours
// (the first three / last three at the ends), oriented along the samples.
function circleTangents(points: ReadonlyArray<Vec2>): Vec2[] {
  return points.map((point, index) => {
    if (points.length < 3) {
      const a = points[0] as Vec2;
      const b = points[points.length - 1] as Vec2;
      return unit(b.x - a.x, b.y - a.y);
    }
    const middle = Math.min(points.length - 2, Math.max(1, index));
    return circleTangentAt(
      points[middle - 1] as Vec2,
      points[middle] as Vec2,
      points[middle + 1] as Vec2,
      point,
    );
  });
}

function circleTangentAt(a: Vec2, b: Vec2, c: Vec2, at: Vec2): Vec2 {
  const chord = unit(c.x - a.x, c.y - a.y);
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-15) return chord;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const tangent = unit(-(at.y - cy), at.x - cx);
  return tangent.x * chord.x + tangent.y * chord.y >= 0
    ? tangent
    : { x: -tangent.x, y: -tangent.y };
}

function firstDirection(from: Vec2, candidates: ReadonlyArray<Vec2>, sign = 1): Vec2 | null {
  for (const candidate of candidates) {
    if (!samePoint(from, candidate)) {
      return unit(sign * (candidate.x - from.x), sign * (candidate.y - from.y));
    }
  }
  return null;
}

function distinct(points: ReadonlyArray<Vec2>): Vec2[] {
  const out: Vec2[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous === undefined || !samePoint(previous, point)) out.push(point);
  }
  return out;
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= SAME_POINT_MM && Math.abs(a.y - b.y) <= SAME_POINT_MM;
}
