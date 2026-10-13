// Segment-level node editing (LightBurn Edit Nodes): insert a node anywhere on
// a segment or at its midpoint, delete a segment, and break an open path at an
// interior node. Every edit keeps the remaining geometry exact: segments are
// cut with the same de Casteljau / arc-angle splits Trim uses, never flattened.
//
// Segment `i` of a contour runs from node `i` to node `i + 1`. A closed
// contour whose last point is not its start has an implied closing line; it is
// segment `segments.length` here and becomes explicit when it is edited.

import {
  applyTransform,
  type CurveSubpath,
  type PathSegment,
  type Transform,
  type Vec2,
} from '../scene';
import { contourSegments, segmentPoint, segmentStart, subSegment } from './trim-curve-split';
import {
  curveSegmentHitGeometry,
  nearestOnLine,
  segmentBoundsCanHit,
} from './curve-segment-hit-geometry';

const SAME_POINT_MM = 1e-9;
const COARSE_SAMPLES = 32;
const REFINE_STEPS = 40;

/** Number of segments a contour has, counting a closed contour's implied closing line. */
export function curveSegmentCount(curve: CurveSubpath): number {
  return contourSegments(curve, curve.closed).segments.length;
}

/** The point at parameter t of one segment. */
export function curveSegmentPoint(
  curve: CurveSubpath,
  segmentIndex: number,
  t: number,
): Vec2 | null {
  const contour = contourSegments(curve, curve.closed);
  const segment = contour.segments[segmentIndex];
  return segment === undefined
    ? null
    : segmentPoint(segmentStart(contour, segmentIndex), segment, t);
}

/** Splits one segment at t (0 < t < 1); the new node becomes node segmentIndex + 1. */
export function insertCurveNode(
  curve: CurveSubpath,
  segmentIndex: number,
  t: number,
): CurveSubpath | null {
  if (!(t > 0 && t < 1)) return null;
  const contour = contourSegments(curve, curve.closed);
  const segment = contour.segments[segmentIndex];
  if (segment === undefined) return null;
  const from = segmentStart(contour, segmentIndex);
  const first = subSegment(from, segment, 0, t);
  const second = subSegment(from, segment, t, 1);
  if (samePoint(first.to, from) || samePoint(first.to, segment.to)) return null;
  const segments = [...contour.segments];
  segments.splice(segmentIndex, 1, first, { ...second, to: segment.to });
  return { ...curve, segments };
}

/**
 * Removes one segment. A closed contour opens there and starts at the end of
 * the removed segment; an open one splits in two, and a piece left without a
 * segment disappears.
 */
export function deleteCurveSegment(
  curve: CurveSubpath,
  segmentIndex: number,
): ReadonlyArray<CurveSubpath> | null {
  const contour = contourSegments(curve, curve.closed);
  if (contour.segments[segmentIndex] === undefined) return null;
  if (curve.closed) {
    const after = contour.segments.slice(segmentIndex + 1);
    const before = contour.segments.slice(0, segmentIndex);
    const start = contour.segments[segmentIndex]?.to ?? curve.start;
    const segments = [...after, ...before];
    return segments.length === 0 ? [] : [{ start, segments, closed: false }];
  }
  return splitOpen(contour.start, contour.segments, segmentIndex, segmentIndex + 1);
}

/** Splits an open contour into two at an interior node. */
export function breakOpenCurveAtNode(
  curve: CurveSubpath,
  nodeIndex: number,
): ReadonlyArray<CurveSubpath> | null {
  if (curve.closed || nodeIndex <= 0 || nodeIndex >= curve.segments.length) return null;
  return splitOpen(curve.start, curve.segments, nodeIndex, nodeIndex);
}

function splitOpen(
  start: Vec2,
  segments: ReadonlyArray<PathSegment>,
  headEnd: number,
  tailStart: number,
): ReadonlyArray<CurveSubpath> {
  const head = segments.slice(0, headEnd);
  const tail = segments.slice(tailStart);
  const tailFrom = tailStart === 0 ? start : (segments[tailStart - 1]?.to ?? start);
  return [
    ...(head.length === 0 ? [] : [{ start, segments: head, closed: false }]),
    ...(tail.length === 0 ? [] : [{ start: tailFrom, segments: tail, closed: false }]),
  ];
}

const DRAG_T_MIN = 0.15;

/**
 * Reshapes one segment so the point grabbed at `t` follows `delta` (LightBurn
 * drag a line or curve). A straight line becomes a cubic first. Both control
 * points move together by delta / (3t(1 - t)), the shift that carries B(t) by
 * exactly `delta` while the segment's end nodes stay put. Arcs are not dragged.
 */
export function dragCurveSegment(
  curve: CurveSubpath,
  segmentIndex: number,
  t: number,
  delta: Vec2,
): CurveSubpath | null {
  const contour = contourSegments(curve, curve.closed);
  const segment = contour.segments[segmentIndex];
  if (segment === undefined || segment.kind === 'elliptical-arc') return null;
  const from = segmentStart(contour, segmentIndex);
  const cubic =
    segment.kind === 'cubic'
      ? segment
      : {
          kind: 'cubic' as const,
          control1: lerpPoint(from, segment.to, 1 / 3),
          control2: lerpPoint(from, segment.to, 2 / 3),
          to: segment.to,
        };
  const s = Math.min(1 - DRAG_T_MIN, Math.max(DRAG_T_MIN, t));
  const k = 1 / (3 * s * (1 - s));
  const shift = { x: delta.x * k, y: delta.y * k };
  const segments = [...contour.segments];
  segments[segmentIndex] = {
    ...cubic,
    control1: { x: cubic.control1.x + shift.x, y: cubic.control1.y + shift.y },
    control2: { x: cubic.control2.x + shift.x, y: cubic.control2.y + shift.y },
  };
  return { ...curve, segments };
}

function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export type CurveSegmentHit = {
  readonly segmentIndex: number;
  readonly t: number;
  /** Nearest point on the segment, in scene coordinates. */
  readonly point: Vec2;
  readonly distance: number;
};

/** The segment of `curve` nearest `scenePoint`, measured after `transform`. */
export function nearestCurveSegment(
  curve: CurveSubpath,
  transform: Transform,
  scenePoint: Vec2,
  maxDistance = Number.POSITIVE_INFINITY,
): CurveSegmentHit | null {
  let best: CurveSegmentHit | null = null;
  curveSegmentHitGeometry(curve, transform).forEach((geometry, segmentIndex) => {
    const { segment, from, sceneFrom, sceneTo, bounds } = geometry;
    if (!segmentBoundsCanHit(bounds, scenePoint, best?.distance ?? maxDistance)) return;
    const at = (t: number) => applyTransform(segmentPoint(from, segment, t), transform);
    const hit =
      segment.kind === 'line'
        ? nearestOnLine(sceneFrom, sceneTo, scenePoint)
        : nearestOnSegment(at, scenePoint);
    if (hit.distance > maxDistance) return;
    if (best === null || hit.distance < best.distance) best = { segmentIndex, ...hit };
  });
  return best;
}

// Coarse sampling finds the right span; a golden-section search inside it
// settles t. Segments are smooth, so this converges on the true nearest point.
function nearestOnSegment(
  at: (t: number) => Vec2,
  target: Vec2,
): { readonly t: number; readonly point: Vec2; readonly distance: number } {
  let bestT = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= COARSE_SAMPLES; index += 1) {
    const t = index / COARSE_SAMPLES;
    const d = distance(at(t), target);
    if (d < bestDistance) {
      bestDistance = d;
      bestT = t;
    }
  }
  let low = Math.max(0, bestT - 1 / COARSE_SAMPLES);
  let high = Math.min(1, bestT + 1 / COARSE_SAMPLES);
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let step = 0; step < REFINE_STEPS; step += 1) {
    const a = high - ratio * (high - low);
    const b = low + ratio * (high - low);
    if (distance(at(a), target) < distance(at(b), target)) high = b;
    else low = a;
  }
  const t = (low + high) / 2;
  const point = at(t);
  return { t, point, distance: distance(point, target) };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= SAME_POINT_MM && Math.abs(a.y - b.y) <= SAME_POINT_MM;
}
